# AURA Protocol Codebase Overview

This document explains what is happening in the AURA Protocol codebase, what parts are working, how the main flows operate, and what outcomes the system produces.

## 1. What This Codebase Is

AURA is a full-stack AI orchestration platform. It combines:

- A React frontend for the user workspace.
- A FastAPI backend for authentication, chat orchestration, routing, persistence, security, and protocol APIs.
- Redis for brokered communication, distributed rate limiting, provider gates, metrics, and worker queues.
- CockroachDB-compatible SQLAlchemy persistence for active-active multi-region storage.
- Isolated worker containers for P2P gossip and Sentinel patch staging.
- OpenTelemetry tracing for request and worker visibility.

The codebase has moved away from a single monolithic MVP shape and now uses a container-isolated architecture:

- `aura-api-gateway`
  - Exposes the FastAPI API.
  - Runs with a read-only filesystem.
  - Accepts frontend/API traffic.
  - Publishes broker messages to Redis.

- `aura-p2p-node`
  - Consumes Redis gossip messages from `aura:p2p:gossip`.
  - Broadcasts them through the P2P/libp2p layer.
  - Runs isolated from direct database mutation.

- `aura-sentinel-core`
  - Consumes patch requests from `aura:sentinel:patches`.
  - Has writable workspace access.
  - Stages code patches for human approval instead of directly mutating production code.

- `aura-redis`
  - Local development Redis broker.
  - In production, this should be replaced or fronted by Redis Enterprise Active-Active endpoints.

- `aura-cockroach-*`
  - Local development CockroachDB cluster nodes.
  - Model the intended multi-region distributed SQL deployment.

## 2. Repository Layout

```text
backend/
  app/
    api/routes/
      auth.py              Authentication routes
      chat.py              Chat API and broker publishing
      p2p.py               P2P API routes and gossip enqueueing
      sentinel.py          Sentinel diagnostics and patch approval routes

    enterprise/
      database.py          SQLAlchemy engine, CockroachDB support, UUIDv7 IDs
      normalized_database.py
                           Normalized user/session/message persistence
      redis_runtime.py     Redis client, reconnect logic, rate limits, gates, queues
      tracing.py           OpenTelemetry setup and trace propagation helpers
      code_healer.py       Sentinel diagnostics, encrypted patch staging, approval gate
      permission_guard.py  Runtime filesystem permission assertions
      security_headers.py  HTTP security headers middleware

    models/
      chat.py              SQLAlchemy ORM models for users, sessions, messages
      routing.py           Routing decision and node health models

    services/
      provider_adapters.py Provider-specific AI adapter logic
      router.py            Supervisor routing and fallback dispatch
      agora_healer.py      Safe payload healing logic
      zk_verifier.py       ZK proof verification service

    workers/
      p2p_node.py          Redis gossip consumer and P2P broadcaster
      sentinel_core.py     Redis patch consumer and Sentinel staging worker

    main.py                FastAPI app factory, middleware, startup/shutdown

frontend/
  src/
    App.tsx                Thin React root wrapper
    appCore.ts             Frontend runtime helpers and model catalog
    components/App/
      AuraAppShell.tsx     Main UI orchestration shell
      AppComponents.tsx    Shared app UI components
    hooks/
      useAuraAuth.ts       Auth token handling and hydration
    utils/
      secureFetch.ts       Signed API request helper
      cryptoStorage.ts     Encrypted browser storage

docker/
  Dockerfile.api-gateway
  Dockerfile.p2p-node
  Dockerfile.sentinel-core
  assert_runtime_permissions.py

tests/
  test_phase1_p2p.py
  test_phase2_routing.py
  test_phase3_zk.py
  test_phase4_agora.py
  test_phase7_security.py

docker-compose.yml         Local multi-service runtime topology
```

## 3. Main Runtime Flow

### 3.1 User Chat Flow

1. The user interacts with the React app.
2. `frontend/src/components/App/AuraAppShell.tsx` collects the prompt, selected model, session state, wallet state, and connected models.
3. The frontend calls the backend using helpers from `frontend/src/appCore.ts`.
4. If the user is authenticated, browser-side helpers add bearer auth and may sign protected requests.
5. The backend receives the request at `POST /api/chat` in `backend/app/api/routes/chat.py`.
6. If `model_id` is `aura`, the backend asks the routing layer for a supervisor decision.
7. `backend/app/services/router.py` picks a target provider/node and fallback node.
8. The backend dispatches to a provider adapter.
9. The response is saved as normalized chat history.
10. The API also publishes a Redis message to `aura:p2p:gossip`.
11. The P2P worker consumes the message and broadcasts it through the P2P layer.

Outcome:

- The user receives an AI response.
- The chat is persisted.
- Routing telemetry is recorded.
- A gossip event is emitted for decentralized visibility.
- OpenTelemetry trace context follows the request into the worker queue.

### 3.2 P2P Gossip Flow

1. API route `POST /api/p2p/gossip` receives a gossip envelope.
2. The route injects OpenTelemetry trace metadata.
3. The route pushes the message to Redis queue `aura:p2p:gossip`.
4. `backend/app/workers/p2p_node.py` blocks on that queue.
5. When a message arrives, the worker extracts the trace context and starts a consumer span.
6. The worker broadcasts the payload through the libp2p host.

Outcome:

- API-originated events can cross into the isolated P2P container.
- The API container does not need direct P2P network permissions.
- Distributed tracing still connects the API span and worker span.

### 3.3 Sentinel Patch Flow

1. Sentinel diagnostics detect or receive an error condition.
2. A patch request is created as a `SentinelPatchRequest`.
3. The request can be sent through the Sentinel API or Redis queue `aura:sentinel:patches`.
4. `backend/app/workers/sentinel_core.py` consumes queued patch requests.
5. `backend/app/enterprise/code_healer.py` validates the target path.
6. The patch is encrypted and staged in `code_diagnostics`.
7. The row is marked `PENDING_APPROVAL`.
8. No file write happens yet.
9. An administrator calls `POST /api/sentinel/approve-patch`.
10. The approval request must include:
    - `diagnostic_id`
    - `admin_id`
    - `admin_role`
    - `staged_patch_sha256`
    - `expires_at`
    - `signature`
11. The backend verifies the HMAC approval signature.
12. The backend decrypts the staged patch.
13. The backend re-validates the path and old text.
14. Only then does it write the patch to disk.

Outcome:

- Production code is not mutated automatically.
- Generated patches are staged for review.
- Mainnet-style deployments require explicit signed human approval.
- Falsified stack traces cannot directly become code writes.

## 4. Database Architecture

The database integration is in `backend/app/enterprise/database.py`.

The current production-oriented choice is CockroachDB-compatible distributed SQL.

Why:

- Standard PostgreSQL primary-replica replication is not write-anywhere.
- A single writable primary creates cross-region latency for distant writers.
- Multi-primary PostgreSQL requires complex conflict handling.
- CockroachDB provides distributed SQL with serializable transactions and regional locality.

Implemented behavior:

- `COCKROACH_DATABASE_URL` is preferred when configured.
- `DATABASE_URL` is still supported.
- SQLite fallback exists for local simple runs.
- `regional_uuidv7()` creates sortable IDs with a regional prefix.
- `retry_database_operation()` retries CockroachDB serializable transaction restarts.
- SQLAlchemy async engine uses `asyncpg` for PostgreSQL/Cockroach-compatible URLs.

Important tables:

- `users_v2`
- `sessions`
- `messages`
- `nodes`
- `chats`
- `oapin_ledger`
- `healing_memory`
- `code_diagnostics`
- `sentinel_patch_log`

Outcome:

- Chat/session/user data can be stored in a globally distributed SQL layer.
- Primary key conflicts are avoided through region-prefixed UUIDv7-style IDs.
- Cockroach transaction restart errors can be retried safely around the whole unit of work.

## 5. Redis Runtime Architecture

Redis integration is in `backend/app/enterprise/redis_runtime.py`.

Redis responsibilities:

- Broker queues:
  - `aura:p2p:gossip`
  - `aura:sentinel:patches`
- Distributed rate limiting.
- Provider concurrency gates.
- Operational metrics.
- Sync watermarks.
- Trace metadata propagation.

Production target:

- Redis Enterprise Active-Active with CRDT synchronization.

Why:

- A single regional Redis instance causes regional state amnesia.
- Rate limits, provider gates, and metrics must be globally visible.
- CRDT-backed active-active Redis keeps the current Redis programming model while adding global replication.

Implemented behavior:

- `GLOBAL_REDIS_URLS` can be configured as:
  - `region|redis://host:6379/0,region2|redis://host2:6379/0`
  - JSON list of strings
  - JSON list of objects with `region` and `url`
- The runtime prefers the local region endpoint.
- Failed endpoints are put on cooldown.
- Operations reconnect with exponential backoff.
- Rate limits are global by default through `REDIS_RATE_LIMIT_SCOPE=global`.
- Queue payloads automatically receive trace metadata if missing.

Outcome:

- Containers can use regional Redis endpoints without changing business logic.
- Brokered workers can remain isolated but coordinated.
- Rate limiting and provider gates are ready for globally replicated Redis.

## 6. Tracing and Observability

Tracing helper code lives in `backend/app/enterprise/tracing.py`.

OpenTelemetry is used for:

- API route spans.
- Redis queue producer metadata.
- Worker consumer spans.
- Cross-container trace propagation.

How it works:

1. `configure_tracing()` sets up a tracer provider.
2. API routes start spans around important operations.
3. `inject_trace_metadata()` writes W3C propagation context into the Redis message metadata.
4. Workers call `start_worker_span()` with the envelope metadata.
5. The worker span becomes a child or continuation of the API trace.

Relevant files:

- `backend/app/main.py`
- `backend/app/api/routes/chat.py`
- `backend/app/api/routes/p2p.py`
- `backend/app/workers/p2p_node.py`
- `backend/app/workers/sentinel_core.py`
- `backend/app/enterprise/redis_runtime.py`
- `backend/app/enterprise/tracing.py`

Outcome:

- A `POST /api/chat` request can be traced after it becomes an async Redis queue message.
- Independent containers can still be observed as one distributed workflow.
- If `OTEL_EXPORTER_OTLP_ENDPOINT` is configured, traces can go to an OTLP collector.
- If no exporter endpoint is configured, console exporting is used.

## 7. Security Architecture

Security is layered across the frontend, API gateway, Redis broker, database, and Sentinel mutation flow.

### Frontend security

Files:

- `frontend/src/utils/cryptoStorage.ts`
- `frontend/src/utils/secureFetch.ts`
- `frontend/src/hooks/useAuraAuth.ts`

What works:

- Auth token storage is encrypted in browser storage.
- Protected requests can be signed.
- Token hydration checks expiry.

### Backend security

Files:

- `backend/app/middleware/hmac_verifier.py`
- `backend/app/api/routes/auth.py`
- `backend/app/enterprise/security_headers.py`
- `backend/app/enterprise/permission_guard.py`

What works:

- Bearer JWT authentication protects authenticated routes.
- HMAC middleware verifies signed requests.
- CORS is restricted through `AURA_ALLOWED_ORIGINS`.
- Security headers are added.
- The API gateway asserts read-only Python tree permissions at startup.

### Sentinel security

Files:

- `backend/app/enterprise/code_healer.py`
- `backend/app/api/routes/sentinel.py`
- `backend/app/workers/sentinel_core.py`

What works:

- Patch paths must be relative.
- Parent traversal is rejected.
- Only `.py` files under allowed roots can be mutated.
- Patches are encrypted before storage.
- Patches are marked `PENDING_APPROVAL`.
- Admin approval requires a valid HMAC signature.
- Default admin secret is rejected outside development/mainnet-like protection modes.

Outcome:

- The API gateway remains read-only.
- The P2P node cannot mutate code.
- Only Sentinel has writable workspace permissions.
- Sentinel still cannot mutate code without a verified approval event.

## 8. Provider and Routing Architecture

Provider routing is handled mainly by:

- `backend/app/services/router.py`
- `backend/app/services/provider_adapters.py`
- `backend/app/models/routing.py`

What happens:

1. A user prompt enters `POST /api/chat`.
2. If using `model_id=aura`, a supervisor routing decision is requested.
3. The router chooses a target node and fallback.
4. The chosen provider adapter is called.
5. If the primary provider fails, fallback dispatch is attempted.
6. Routing telemetry is stored.

Supported target provider categories include:

- OpenAI
- Gemini
- Claude
- DeepSeek
- Mistral
- Hugging Face
- OpenAI-compatible providers

Outcome:

- AURA can dynamically route user prompts to different AI backends.
- Failures can fall back to another provider.
- Routing success and latency can be measured.

## 9. Frontend Application Behavior

The frontend app is centered in:

- `frontend/src/App.tsx`
- `frontend/src/components/App/AuraAppShell.tsx`
- `frontend/src/components/App/AppComponents.tsx`
- `frontend/src/appCore.ts`

What it does:

- Displays the AURA workspace.
- Manages login and session hydration.
- Tracks selected models and connected models.
- Sends chat prompts to the backend.
- Displays response cards.
- Supports council-style multi-output state.
- Manages uploaded files.
- Tracks wallet-related UI state.
- Loads and syncs chat sessions.

Outcome:

- Users get a single UI for interacting with multiple AI providers.
- Responses can be displayed as separate cards and synthesized.
- Authenticated users can keep session history.

## 10. Worker Architecture

### P2P worker

File:

- `backend/app/workers/p2p_node.py`

Responsibilities:

- Connect to Redis.
- Bootstrap libp2p host.
- Consume `aura:p2p:gossip`.
- Continue the OpenTelemetry trace.
- Broadcast payloads on the P2P network.

Outcome:

- P2P behavior is isolated from the API gateway.

### Sentinel worker

File:

- `backend/app/workers/sentinel_core.py`

Responsibilities:

- Connect to Redis.
- Initialize Sentinel schema.
- Consume `aura:sentinel:patches`.
- Continue the OpenTelemetry trace.
- Stage patches through `SentinelCodeHealer`.

Outcome:

- Code mutation workflow is isolated to one container.
- Patch requests become staged approval records, not direct writes.

## 11. Docker Compose Runtime

The current `docker-compose.yml` defines:

- `aura-api-gateway`
- `aura-p2p-node`
- `aura-sentinel-core`
- `aura-redis`
- `aura-cockroach-us-east`
- `aura-cockroach-eu-west`
- `aura-cockroach-ap-south`
- `aura-cockroach-init`

Important network boundaries:

- `aura-edge`
  - Public/API-facing edge network.

- `aura-broker`
  - Internal Redis broker network.

- `aura-data`
  - Internal database network.

- `aura-p2p`
  - P2P worker network.

Outcome:

- API, broker, data, P2P, and mutation capabilities are separated.
- The system can be run locally with a topology that resembles production isolation.

## 12. What Is Working Now

The following parts are implemented in code:

- FastAPI app startup and shutdown lifecycle.
- Route registration for auth, chat, P2P, and Sentinel.
- JWT provider login.
- Authenticated `/api/auth/me`.
- Chat request handling through `/api/chat`.
- Supervisor routing and fallback dispatch.
- Normalized user/session/message persistence.
- CockroachDB-compatible SQLAlchemy engine configuration.
- Region-prefixed UUIDv7-style IDs.
- Cockroach retry wrapper for transaction restarts.
- Redis JSON queue publishing and consuming.
- Redis reconnect/backoff behavior.
- Global Redis endpoint configuration.
- Distributed rate limiting and provider gates.
- OpenTelemetry trace propagation into Redis queue metadata.
- P2P queue worker.
- Sentinel queue worker.
- Encrypted Sentinel patch staging.
- Signature-verified Sentinel patch approval.
- Docker Compose service isolation.
- Frontend shell, auth hydration, chat state, wallet UI state, upload state, and model selection.

## 13. Expected Outcomes

When the system is configured correctly, the expected outcomes are:

### User outcome

- Users can log in.
- Users can send prompts.
- Users receive AI-generated responses.
- Users can keep chat sessions.
- Users can interact with a multi-model/council-style interface.

### Platform outcome

- Requests are routed to suitable AI providers.
- Provider failures can fall back to alternatives.
- Request and worker flows can be traced.
- Chat data is stored durably.
- Redis coordinates queueing, rate limits, and provider gates.

### Infrastructure outcome

- The API gateway can run read-only.
- Workers are isolated by responsibility.
- Database writes are active-active compatible through CockroachDB.
- Redis can be replaced with Redis Enterprise Active-Active for global state.
- Sentinel mutation is controlled by human approval.

### Security outcome

- Browser tokens are encrypted at rest.
- Signed requests can be verified.
- Code patches do not automatically write to disk.
- Admin approvals are time-bound and signature verified.
- Default production secrets are rejected for Sentinel approval.

## 14. Important Environment Variables

### API and auth

```text
JWT_SECRET
AURA_ALLOWED_ORIGINS
AURA_ENVIRONMENT
```

### Database

```text
DATABASE_ENGINE
DATABASE_URL
COCKROACH_DATABASE_URL
DB_TRANSACTION_RETRIES
AURA_REGION
AURA_REGION_ID_PREFIX
```

### Redis

```text
REDIS_URL
GLOBAL_REDIS_URLS
REDIS_GLOBAL_SYNC_MODE
REDIS_RATE_LIMIT_SCOPE
REDIS_CONNECT_ATTEMPTS
REDIS_OPERATION_RETRIES
REDIS_RECONNECT_BACKOFF_SECONDS
REDIS_ENDPOINT_COOLDOWN_MAX_SECONDS
```

### OpenTelemetry

```text
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_INSECURE
```

### Sentinel

```text
AURA_SENTINEL_DIAGNOSTICS_ENABLED
AURA_SENTINEL_MUTATION_ENABLED
AURA_SENTINEL_ALLOWED_ROOTS
AURA_SENTINEL_ADMIN_HMAC_SECRET
AURA_SENTINEL_ADMIN_ROLE
AURA_SENTINEL_PATCH_KEY
AURA_SENTINEL_TOKEN
GEMINI_API_KEY
```

### Provider keys

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
DEEPSEEK_API_KEY
MISTRAL_API_KEY
```

## 15. Known Gaps and Risks

These are the main things to be aware of:

- Local Docker validation requires Docker Desktop to be installed.
- Running tests requires Python dependencies, including `pytest`.
- Redis Enterprise Active-Active cannot be fully simulated by the local `redis:alpine` container.
- The frontend shell is still large and should eventually be split into feature modules.
- Some provider behavior depends on external API keys and upstream availability.
- CockroachDB local compose gives topology shape, but true multi-region latency and failure behavior must be tested in real infrastructure.
- Sentinel approval currently uses HMAC credentials. For stronger enterprise deployments, this should evolve to hardware-backed signing, OIDC admin identity, or KMS-backed signing.

## 16. Recommended Next Steps

1. Add CI checks for:
   - Python syntax
   - unit tests
   - frontend build
   - Docker Compose config validation

2. Add integration tests for:
   - Redis trace propagation
   - Sentinel patch staging and approval
   - Cockroach transaction retry behavior
   - P2P worker message consumption

3. Add production infrastructure manifests:
   - Kubernetes deployments
   - Network policies
   - Redis Enterprise endpoint secrets
   - CockroachDB secure TLS configuration
   - OpenTelemetry collector deployment

4. Strengthen Sentinel approval:
   - Replace shared-secret HMAC with asymmetric signatures.
   - Add approval audit trail with immutable log storage.
   - Add diff previews and reviewer identity binding.

5. Split large frontend/backend modules:
   - Break `AuraAppShell.tsx` into domain hooks and feature components.
   - Keep backend routes grouped by domain.
   - Keep provider adapters independently testable.

## 17. Short Summary

AURA is now structured as a distributed AI orchestration system:

- React handles the user workspace.
- FastAPI handles authenticated API orchestration.
- CockroachDB provides active-active-compatible SQL persistence.
- Redis provides replicated broker and coordination semantics.
- OpenTelemetry connects API requests to async workers.
- P2P and Sentinel run as isolated containers.
- Sentinel code mutation is staged and requires signed human approval.

The outcome is a safer, more observable, multi-region-ready foundation for an AI routing and protocol platform.

## 18. Master Engineering Standards

This section records the engineering rules that should guide future AURA upgrades. It is intentionally written as a human-readable contract, not as generated code. The goal is to improve the codebase without breaking its current structure or forcing large rewrites.

### 18.1 Upgrade Strategy

Future upgrades should be done one module at a time.

Do not ask an AI or developer to rewrite the entire system in one session. The safer pattern is:

1. Pick one module.
2. State the relevant invariants.
3. Patch only that module and its direct tests.
4. Verify locally.
5. Commit the small change.

This keeps risk low and makes production debugging much easier.

### 18.2 Immutable Architecture Rules

The intended container boundaries are:

- `aura-api-gateway`
  - Handles public API traffic.
  - Should run as a non-root user.
  - Should keep Python source read-only.
  - Should not perform direct P2P operations.

- `aura-p2p-node`
  - Handles P2P networking.
  - Consumes brokered messages.
  - Should not mutate application source.

- `aura-sentinel-core`
  - Owns controlled workspace mutation.
  - Must validate patch paths.
  - Must stage patches before approval.
  - Must require verified administrator approval before applying changes.

The long-term target is to re-enable strict zero-trust startup checks after cloud runtime behavior is fully understood.

### 18.3 Security Rules

The following rules should be treated as hard requirements for future production work:

- No hardcoded secrets.
- No committed `.env` files.
- No wildcard CORS in production.
- No `eval()`, `exec()`, or unsafe deserialization of untrusted input.
- No shell execution using unsanitized user input.
- No SQL string interpolation for user-controlled values.
- No external HTTP call without an explicit timeout.
- No direct code mutation without path validation and approval.
- No default admin secret outside development.
- Use `hmac.compare_digest()` for signature comparison.
- Keep security headers enabled on all API responses.

### 18.4 Database Rules

Database changes should follow these rules:

- Prefer async SQLAlchemy 2.x patterns.
- Use bound parameters for all SQL.
- Keep CockroachDB transaction retry behavior for serialization conflicts.
- Use region-prefixed UUIDv7-style IDs for globally generated records.
- Avoid migrations that depend on single-node PostgreSQL assumptions.
- Keep SQLite fallback useful for local development, but do not let local shims shadow real installed packages.

### 18.5 Redis Rules

Redis should remain the coordination layer for:

- broker queues
- distributed rate limits
- provider gates
- metrics
- trace propagation metadata

For local development and MVP deployment, Redis may be optional. For production deployments that require strict coordination, set:

```text
AURA_REQUIRE_REDIS=true
```

When Redis is required, startup should fail if no endpoint is reachable.

### 18.6 Tracing Rules

Any request that crosses a Redis queue boundary should carry trace metadata.

The expected flow is:

1. API route starts a span.
2. Queue payload receives trace metadata.
3. Worker extracts trace metadata.
4. Worker starts a child span.
5. Worker records message type, queue name, and outcome.

This keeps API and worker behavior observable as one distributed flow.

### 18.7 Sentinel Mutation Rules

Sentinel mutation must remain human-in-the-loop.

Patch approval should include:

- diagnostic ID
- admin ID
- admin role
- staged patch digest
- expiry timestamp
- HMAC or stronger asymmetric signature

Before applying a patch, Sentinel must:

1. Re-validate the target path.
2. Confirm the file is still the same version that was staged.
3. Verify approval signature.
4. Apply changes atomically.
5. Write an immutable audit record.

### 18.8 Module Upgrade Roadmap

The best future upgrade order is:

1. `backend/app/main.py`
   - Replace deprecated startup events with a lifespan context.
   - Re-enable zero-trust permission checks once Render runtime execution is fixed.
   - Add DB and Redis readiness details to `/health`.

2. `backend/app/enterprise/redis_runtime.py`
   - Add sliding-window Lua rate limiting.
   - Add stronger provider gate release semantics.
   - Add structured metric recording.

3. `backend/app/services/router.py`
   - Add fault-diverse top-K routing.
   - Add latency/reputation/load scoring.
   - Add hedged provider calls and consensus selection.

4. `backend/app/api/routes/auth.py`
   - Add nonce-based wallet authentication.
   - Enforce stronger JWT validation.
   - Add replay-resistant login flow.

5. `backend/app/enterprise/code_healer.py`
   - Replace shared-secret HMAC with asymmetric or KMS-backed approval.
   - Verify old file hash before applying staged patches.
   - Add richer immutable audit records.

6. `backend/app/workers/p2p_node.py`
   - Add graceful shutdown.
   - Add structured JSON logs.
   - Improve Redis reconnect backoff.

7. `backend/app/services/zk_verifier.py`
   - Add a production verifier sidecar interface.
   - Persist proof receipts with explicit verification states.

8. `frontend/src/utils/cryptoStorage.ts` and `frontend/src/utils/secureFetch.ts`
   - Prefer session-scoped encrypted storage for sensitive tokens.
   - Add request timeouts and consistent session-expired behavior.

### 18.9 Dependency Direction

The long-term production target is Python 3.11 because native cryptographic and P2P dependencies are more predictable there than on newer Python versions.

Production Docker images should use:

```text
python:3.11-slim
```

Native build dependencies should be installed before Python requirements:

```text
build-essential
gcc
libgmp-dev
python3-dev
```

The codebase should eventually converge on one pinned dependency set for local, Docker, and CI environments.

### 18.10 CI Direction

The best next CI pipeline should run:

- Python syntax/import checks
- unit tests with `pytest`
- frontend build
- Docker build
- Docker Compose config validation
- secret scanning

CI should fail if:

- `.env` files are staged
- Python source is unexpectedly writable in API images
- Docker images run as root
- security headers are missing
- CORS is wildcard in production mode

### 18.11 Current Temporary Exceptions

Two temporary MVP exceptions currently exist and should be tracked:

- The FastAPI startup permission assertion is temporarily commented out for Render runtime debugging.
- Redis is optional by default so local and MVP deployments can boot without a managed Redis endpoint.

These exceptions are operationally useful, but they should not become permanent production defaults.

## 19. Completion Roadmap To 100%

This section distills the AURA completion prompt into a practical execution plan. It should be used as a roadmap for future focused coding sessions. Each item should be implemented as its own small change set, with tests and verification, rather than as one large rewrite.

### 19.1 Current Completion Gaps

The current system is operational as an MVP, but these pillars remain incomplete or only partially implemented:

- BYOC routing has basic fallback behavior, but not multi-objective scoring, fault-diverse top-K selection, hedged dispatch, or consensus aggregation.
- P2P is currently broker-to-libp2p oriented, but not a full Kademlia DHT, Vivaldi coordinate, and ANP negotiation stack.
- ZKML verification needs a production receipt interface, sidecar verification path, and reputation penalty behavior.
- AGORA healing needs the full DOM pruning, validation cascade, and healing-memory workflow.
- AuraCredit smart-contract integration is not yet wired into backend ledger services.
- CI/CD needs a full GitHub Actions pipeline with linting, tests, Docker validation, and security scanning.
- Kubernetes production manifests are not yet present.
- Integration tests exist, but broader real-flow coverage is still needed.

### 19.2 Six Completion Pillars

The recommended completion order is:

1. BYOC Routing
   - File: `backend/app/services/router.py`
   - Add scored endpoint selection, provider/region diversity, parallel dispatch, hedged request behavior, consensus aggregation, key rotation, and routing decision persistence.

2. P2P Full Stack
   - Files: `backend/app/workers/p2p_node.py`, `backend/app/services/p2p_protocol.py`
   - Add Kademlia routing, Vivaldi latency coordinates, structured gossip, ANP contract-net negotiation, and graceful worker shutdown.

3. ZKML Verifier
   - File: `backend/app/services/zk_verifier.py`
   - Add receipt models, verifier sidecar calls, stub acceptance tracking, pending verification state, expired-job handling, and reputation penalties.

4. AGORA DOM Healer
   - File: `backend/app/services/agora_healer.py`
   - Add DOM pruning, selector synthesis, validation cascade, Redis-backed warm start, and healing memory updates.

5. AuraCredit and Web3 Ledger
   - Files: `contracts/AuraCredit.sol`, `backend/app/services/credit_ledger.py`
   - Add ERC-20-style compute credits, utilisation-based price updates, node slashing, and backend ledger sync.

6. CI/CD, Kubernetes, and Integration Tests
   - Files: `.github/workflows/ci.yml`, `k8s/`, `tests/`
   - Add lint/type/test/build/security jobs, deployment manifests, network policies, and real integration coverage.

### 19.3 Completion Database Tables

The eventual production schema should include or preserve these tables:

- `zkml_receipts`
- `healing_memory`
- `routing_decisions`
- `oapin_ledger`
- `sentinel_patch_log`

The `sentinel_patch_log` table should be treated as insert-only audit history. Application code should never update or delete rows from it.

### 19.4 Completion Checklist

Use this checklist to track progress after each module:

BYOC routing:

- [ ] Capability and routing decision models are complete.
- [ ] Multi-factor scoring formula is implemented.
- [ ] Fault-diverse top-K selection works.
- [ ] Parallel dispatch and hedged cancellation work.
- [ ] Consensus aggregation works.
- [ ] EMA latency updates are written to Redis.
- [ ] KeyPool rotates provider keys and penalty-boxes 429 keys.
- [ ] Routing decisions persist asynchronously.

P2P full stack:

- [ ] Kademlia buckets and XOR-distance ordering work.
- [ ] Iterative node lookup works.
- [ ] Vivaldi coordinate updates work.
- [ ] ANP sealed-bid negotiation works.
- [ ] P2P worker runs gossip, heartbeat, and ANP listener tasks.
- [ ] Worker shutdown drains cleanly.
- [ ] Worker logs structured JSON.

ZKML verifier:

- [ ] Receipt schema is complete.
- [ ] Stub, Halo2, and PLONK proof branches exist.
- [ ] Sidecar failure returns pending verification.
- [ ] Reputation penalties are atomic and floor at zero.
- [ ] Expired pending receipts become unverifiable or penalized.
- [ ] Commitment computation is deterministic.

AGORA healer:

- [ ] DOM pruning removes unsafe and irrelevant markup.
- [ ] Selector synthesis path exists.
- [ ] Validation cascade runs in order.
- [ ] Redis healing memory warm-starts successful selectors.
- [ ] Full heal cycle has timeout handling.
- [ ] Healing results are persisted or recorded.

AuraCredit:

- [ ] Smart contract supports compute credit transfer.
- [ ] Protocol fee is handled.
- [ ] Price oracle update path exists.
- [ ] Node slashing path exists.
- [ ] Backend ledger can sync on-chain events.

CI/CD:

- [ ] Lint and type checks run.
- [ ] Unit tests run.
- [ ] Docker images build.
- [ ] Images are checked for non-root execution.
- [ ] Security scans run.
- [ ] Compose or Kubernetes config validates.

Kubernetes:

- [ ] Namespace is defined.
- [ ] Secrets are templated without real values.
- [ ] API gateway deployment uses non-root and read-only root filesystem.
- [ ] P2P deployment exposes the required P2P port.
- [ ] Sentinel is singleton with writable workspace volume.
- [ ] Services and ingress are defined.
- [ ] Network policies default-deny and explicitly allow required paths.

Integration tests:

- [ ] P2P queue and trace propagation are tested.
- [ ] Routing scoring, diversity, dispatch, and key rotation are tested.
- [ ] ZKML stub, sidecar, and expiry paths are tested.
- [ ] AGORA validation and warm-start paths are tested.
- [ ] JWT, HMAC, Sentinel path safety, CORS, headers, and rate limiting are tested.

### 19.5 Execution Rule

Do not implement all completion pillars at once. Pick one pillar, patch the smallest responsible set of files, verify locally, then commit. This keeps the codebase stable and makes each improvement reviewable.
