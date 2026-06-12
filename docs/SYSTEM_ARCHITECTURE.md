# AURA System Architecture

## Overview

AURA is a full-stack AI orchestration platform with a React/Vite frontend and a FastAPI backend. The system is designed around a multi-model "council" experience where one user prompt can be routed to one or more providers, aggregated, verified, persisted, and optionally enriched by supporting protocols such as P2P networking, payload healing, and zero-knowledge verification.

At a high level:

1. The frontend renders the AURA workspace, authentication flows, model selection, uploads, history, and wallet-related UX.
2. The frontend sends API requests to the FastAPI backend at `VITE_BACKEND_URL` or `http://localhost:8000`.
3. The backend authenticates users, manages sessions, fans requests out to AI providers, stores history and node metadata, and exposes operational endpoints.
4. Supporting backend services provide routing, distributed rate limiting, P2P protocol features, payload healing, ZK verification, and health monitoring.

## Top-Level Repository Layout

```text
backend/
  main.py                    Primary FastAPI application and API surface
  middleware/                HMAC verification middleware
  network/                   libp2p integration
  verification/              zero-knowledge verification worker
  app/
    enterprise/              database, Redis runtime, sentinel health worker
    middleware/              app-level middleware package
    models/                  typed routing models
    network/                 network host abstraction
    services/                routing, healing, ZK service logic

frontend/
  src/
    App.tsx                  thin root wrapper
    components/App/          main AURA shell and shared app UI pieces
    context/                 app context provider
    hooks/                   auth/session hooks
    utils/                   secure fetch and encrypted browser storage
    appCore.ts               frontend runtime helpers and model catalog

docs/
  SYSTEM_ARCHITECTURE.md     this file

tests/
  test_phase1_p2p.py
  test_phase2_routing.py
  test_phase3_zk.py
  test_phase4_agora.py
  test_phase7_security.py
```

## Runtime Architecture

### Frontend

The frontend is a Vite + React application.

- `frontend/src/App.tsx` is intentionally thin and only composes `AppContextProvider` and `AuraAppShell`.
- `frontend/src/components/App/AuraAppShell.tsx` is the main application container. It owns:
  - app boot/loading behavior
  - authentication hydration
  - theme state
  - model and connected-node selection
  - council chat state
  - session history sync/load
  - wallet and upload UX
  - orchestration calls to backend endpoints
- `frontend/src/components/App/AppComponents.tsx` contains large shared UI subcomponents used by the shell.
- `frontend/src/hooks/useAuraAuth.ts` centralizes browser-side auth token handling and session restoration helpers.
- `frontend/src/utils/cryptoStorage.ts` encrypts stored values in `localStorage` using AES-GCM with a PBKDF2-derived key.
- `frontend/src/utils/secureFetch.ts` signs protected requests with request HMAC headers.
- `frontend/src/appCore.ts` contains:
  - backend URL resolution
  - Google SDK loading
  - in-memory auth header/token helpers
  - `callAI()` for chat requests
  - built-in model catalog and ranking logic

### Backend

The backend is a monolithic FastAPI application centered in `backend/main.py`, with supporting services extracted into `backend/app/...`.

- `backend/main.py` defines the app, middleware, startup/shutdown hooks, API endpoints, provider fan-out behavior, auth flows, and orchestration logic.
- `backend/app/services/router.py` implements model routing decisions, target-node dispatch, fallback behavior, and routing telemetry.
- `backend/app/services/agora_healer.py` implements safe payload healing by generating or deriving a JMESPath query to recover expected fields from malformed payloads.
- `backend/app/services/zk_verifier.py` implements in-process Groth16 verification with worker concurrency, timeout control, verification-key caching, and a circuit breaker.
- `backend/app/enterprise/database.py` provides async SQLAlchemy engine setup and schema bootstrap for persistence.
- `backend/app/enterprise/redis_runtime.py` provides distributed rate limiting and provider concurrency gates, with local fallbacks when Redis is absent.
- `backend/app/enterprise/sentinel.py` provides health snapshots and a watchdog worker for operational telemetry.
- `backend/network/libp2p_node.py` and related network modules support Phase 1 P2P compute swarm features.

## Core Request Flows

### 1. App Boot and Session Hydration

On startup:

1. `App.tsx` mounts `AuraAppShell`.
2. `AuraAppShell` calls `useAuraAuth()` for auth state.
3. A session token is loaded from encrypted browser storage via `readStoredAccessToken()`.
4. If a token exists and is not expired, the frontend calls `GET /api/auth/me`.
5. The returned profile hydrates the user session and enables authenticated features.

### 2. Chat Flow

The primary chat path is:

1. The user submits a prompt in the frontend shell.
2. The frontend constructs a request body containing:
   - `model_id`
   - `messages`
   - `user_id`
   - `session_id`
   - optional `override_system`
3. The frontend sends the request to `POST /api/chat`.
4. If a JWT exists, the request may be HMAC-signed via `secureFetch`.
5. The backend selects provider logic based on the requested model and current backend configuration.
6. The backend calls upstream providers such as OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, Hugging Face, Mistral, DeepSeek, or internal routing logic.
7. The backend returns normalized response text to the frontend.
8. The frontend stores responses in card-based council state and can optionally trigger synthesis or verification actions.

### 3. Session History Flow

Authenticated history persistence works like this:

1. The frontend loads previous history from `GET /api/history/load/{user_id}`.
2. Current cards and wallet state are locally tracked in `AuraAppShell`.
3. A debounced sync sends updates to `POST /api/history/sync`.
4. Chat session summaries are loaded from `GET /api/chats/sessions`.
5. Backend persistence stores user and chat-related data in SQLite by default or PostgreSQL when `DATABASE_URL` is configured.

### 4. Authentication Flow

Supported auth entry points include:

- `POST /api/auth/google`
- `POST /api/auth/web3`
- `POST /api/auth/provider`
- `GET /api/auth/me`

The browser stores the token in encrypted local storage, and the backend validates it on protected routes. Signed HMAC requests add a second layer of request integrity for selected API calls.

## Frontend Architecture Details

### Composition Model

The frontend follows a shell-first composition model:

- `App.tsx` is the root boundary.
- `AppContextProvider` exposes high-level app metadata.
- `AuraAppShell` acts as the orchestration layer.
- `AppComponents.tsx` supplies reusable visual and interaction primitives.

This keeps the entry point simple while allowing the shell to act as a stateful coordinator.

### State Domains in `AuraAppShell`

The shell currently coordinates several state domains:

- authentication and user profile
- onboarding and landing flow
- theme and system dark mode
- selected and available AI models
- connected council nodes
- current prompt and active session
- response cards and synthesis state
- wallet balance and wallet connection
- uploaded files
- mobile/sidebar UI state
- session history

### Security on the Frontend

Security-sensitive browser behavior is split across utilities:

- `cryptoStorage.ts` encrypts persisted values before they reach `localStorage`
- `useAuraAuth.ts` manages token persistence, restoration, and clearing
- `secureFetch.ts` computes:
  - `X-AURA-Signature`
  - `X-AURA-Timestamp`
- `appCore.ts` caches the current bearer token in memory for request headers

## Backend Architecture Details

### API Surface

Key backend endpoints defined in `backend/main.py` include:

#### Health and operations

- `GET /health`
- `GET /api/routing/stats`
- `GET /api/sentinel/status`
- `GET /api/protocols/status`

#### Authentication

- `GET /api/auth/me`
- `POST /api/auth/google`
- `POST /api/auth/web3`
- `POST /api/auth/provider`

#### Model and provider access

- `GET /api/openrouter/models`
- `POST /api/openrouter/models`
- `GET /api/openrouter/free-models`
- `POST /api/openrouter/chat`
- `POST /api/groq/models`
- `POST /api/groq/chat`
- `GET /api/hf-models`
- `POST /api/hf-models`
- `POST /api/huggingface/chat`
- `POST /api/chat`
- `POST /api/chat/amalgamate`

#### Persistence and app data

- `GET /api/history/load/{user_id}`
- `POST /api/history/sync`
- `GET /api/chats/sessions`
- `POST /api/nodes`
- `DELETE /api/nodes/{node_name}`
- `POST /api/upload`

#### Protocol and advanced features

- `POST /api/oapin/verify`
- `POST /api/agora/heal`
- `GET /api/agora/memory`
- `POST /api/agora/diagnose`
- `POST /api/p2p/handshake`
- `GET /api/p2p/peers`
- `POST /api/p2p/gossip`
- `POST /api/mcp/execute`
- `GET /api/mcp/tools`
- `POST /api/anp/negotiate`

### Provider Orchestration

The backend is built to route and gate calls across multiple providers.

Important pieces:

- API keys are loaded from environment variables and managed through `KeyPool`.
- `KeyPool` supports multiple keys per provider and cooldown for exhausted keys.
- `bounded_provider_post()` applies retry logic and concurrency gating.
- `provider_gate()` in Redis runtime prevents parallel overload across app instances.
- provider-specific limits are centrally defined in `PROVIDER_LIMITS`.

This design allows the app to:

- spread traffic across multiple upstream API keys
- reduce 429/503 failures
- add limited retries
- keep behavior consistent across providers

### Routing Layer

`backend/app/services/router.py` implements the routing subsystem.

Responsibilities:

- ask a supervisor model for a routing decision
- validate/parse the structured decision
- gather health for target nodes
- dispatch work to a target node
- fallback to another node if needed
- record routing telemetry in the database
- summarize routing performance through `routing_stats()`

The routing decision model supports:

- a primary target
- a fallback target
- a confidence score

### ZK Verification Layer

`backend/app/services/zk_verifier.py` implements a non-subprocess verification pipeline.

Capabilities:

- parse and validate Groth16 verification keys and proofs
- cache verification keys with TTL
- verify with `py_ecc` when available
- fall back to deterministic development verification logic when needed
- process jobs via a worker queue
- enforce timeout limits
- open a circuit breaker after repeated failures

### Agora Healing Layer

`backend/app/services/agora_healer.py` is a defensive subsystem for recovering data from malformed payloads.

Its design goals are:

- recover missing values through a safe navigation query
- never execute generated code
- reject injection-like query output
- use JMESPath when available
- fall back to constrained dotted-path traversal otherwise

This is explicitly a safe query-generation mechanism, not arbitrary code execution.

### P2P and ANP Layer

The backend includes P2P-oriented protocol features:

- libp2p host bootstrap
- peer handshake and peer listing
- gossip-based broadcast
- optional ANP bidding worker controlled by `AURA_ENABLE_ANP_WORKER`

These capabilities are exposed through the `/api/p2p/*` and `/api/anp/*` endpoints and correspond to the earlier "phase" test structure in the repo.

## Persistence Architecture

### Database

Persistence is managed by `backend/app/enterprise/database.py`.

Database behavior:

- default database: SQLite file `aura_network.db`
- production override: PostgreSQL via `DATABASE_URL`
- access style: async SQLAlchemy engine with raw SQL text queries

Initialized tables include:

- `users`
- `nodes`
- `chats`
- `oapin_ledger`
- `healing_memory`

Notable stored data:

- user identity and profile metadata
- serialized card/session history
- wallet balance
- node/provider registrations
- individual chat records
- protocol verification results
- healing memory paths

### Redis

Redis is optional but enhances multi-instance behavior.

Redis responsibilities:

- rate limiting
- provider concurrency gates
- metric counters
- sentinel status publication

If Redis is unavailable, the code falls back to in-process semaphores for some behaviors.

## Security Architecture

The security model spans both browser and backend.

### Frontend controls

- encrypted token storage with AES-GCM
- request signing with HMAC-SHA256
- timestamped signed requests
- bearer token memory cache
- token-expiry checks during hydration

### Backend controls

- HMAC verification middleware
- JWT-based auth handling
- distributed rate limiting
- provider saturation gates
- query safety filtering in healing logic
- ZK verification isolation through worker queue and timeouts

### Security boundaries

There are three important trust boundaries:

1. Browser to backend
   - bearer auth
   - optional HMAC request signing
2. Backend to external providers
   - provider-specific API keys
   - concurrency and retry controls
3. Backend to persistence/runtime services
   - database engine
   - optional Redis coordination

## Deployment Architecture

### Docker Compose

`docker-compose.yml` defines a single full-stack containerized app:

- service name: `app`
- container name: `aura-fullstack`
- exposed port: `3000:10000`
- mounted backend data volume: `./backend/data:/app/backend/data`

Important env vars there:

- `PORT=10000`
- `BACKEND_PORT=8000`
- `AURA_DATA_DIR=/app/backend/data`
- `AURA_ENABLE_ANP_WORKER=false`

### Render Deployment

`render.yaml` deploys the app as a Docker web service with:

- health check path: `/api/protocols/status`
- persistent disk mounted at `/app/backend/data`
- generated `JWT_SECRET`
- externally supplied provider API keys

## Observability and Operations

Operational visibility is handled through:

- `/health`
- `/api/routing/stats`
- `/api/sentinel/status`
- `/api/protocols/status`
- Redis-backed metrics
- sentinel watchdog snapshots

Sentinel monitors:

- CPU usage
- memory usage
- recent 5xx rate

and publishes a degraded/healthy status when Redis is available.

## Architectural Strengths

- Clear frontend/backend separation
- Broad provider interoperability
- Centralized auth/session helper on the frontend
- Optional distributed runtime coordination through Redis
- Fallback-friendly provider orchestration
- Built-in protocol experimentation layers for routing, P2P, healing, and ZK
- Reasonable local-first defaults with production overrides

## Current Architectural Tradeoffs

- `AuraAppShell.tsx` is still a very large orchestration component, so frontend domain boundaries are only partially extracted.
- `backend/main.py` remains a large monolith even though several services have already been moved into `backend/app/services`.
- The system mixes classic app concerns with experimental protocol concerns in the same backend process.
- Some data is still persisted as serialized blobs, which is convenient but less normalized for analytics and reporting.

## Recommended Next Refactors

If this architecture is going to evolve further, the highest-leverage next steps are:

1. Split `AuraAppShell.tsx` into feature modules for auth, council chat, sessions, wallet, and uploads.
2. Move backend endpoint groups from `main.py` into dedicated FastAPI routers.
3. Introduce service interfaces for provider adapters so upstream integrations are easier to test and swap.
4. Normalize persisted chat/session structures beyond serialized card blobs.
5. Add a short architecture decision record set in `docs/` for major subsystems like routing, security signing, and ZK verification.

## Short Summary

AURA is a full-stack AI orchestration system built as:

- React/Vite frontend for the council UX
- FastAPI backend for auth, orchestration, persistence, and protocol services
- SQLite/PostgreSQL for durable state
- optional Redis for distributed coordination
- multi-provider AI integration with routing, fallback, and safety layers

The current codebase is functional and fairly capable, with the main architectural tension being that the primary frontend shell and backend entry file still carry a lot of orchestration responsibility.
