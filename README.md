Markdown# AURA Protocol

AURA is a high-performance, full-stack distributed AI orchestration platform designed for secure, multi-model consensus, agentic workflows, and decentralized P2P routing. Built with a container-isolated, zero-trust architecture, AURA splits edge traffic, background synchronization, and self-healing automation into cryptographically guarded runtime boundaries.

---

## 🚀 Architecture Overview

AURA operates as a decoupled microservices swarm to maintain strict security boundaries and regional data locality:

* **`aura-api-gateway` (FastAPI):** Exposes core protocol routes. Operates entirely on a **read-only** filesystem to eliminate remote code execution (RCE) vectors.
* **`aura-p2p-node` (Python/libp2p):** Consumes broadcast messages via an isolated Redis layer and gossips state changes globally without database write permissions.
* **`aura-sentinel-core` (Python/AI Healer):** Monitors runtime health, generates secure diagnostics, and stages encrypted codebase patches awaiting explicit cryptographic admin signatures.
* **`aura-redis`:** Replicated message broker mediating rate-limiting, concurrency gates, and distributed OpenTelemetry context propagation.
* **`aura-cockroach-*`:** Distributed multi-region active-active SQL deployment utilizing region-prefixed UUIDv7 keys for zero-collision persistence.

---

## 📂 Repository Layout

```text
├── backend/
│   ├── app/
│   │   ├── api/routes/          # Auth, Chat orchestration, P2P Gossip, and Sentinel
│   │   ├── enterprise/          # SQL Engines, Redis runtimes, Tracing, and Permission Guards
│   │   ├── models/              # SQLAlchemy ORM models & Routing schemas
│   │   ├── services/            # Provider adapters (Gemini, OpenRouter, etc.) & Routers
│   │   └── workers/             # Async background container consumers (P2P, Sentinel)
│   └── main.py                  # Core FastAPI application factory
├── frontend/
│   ├── src/
│   │   ├── components/App/      # AuraAppShell workspace UI
│   │   ├── hooks/               # Encrypted token hydration & session states
│   │   └── utils/               # Secure fetch signing & crypto storage
├── docker/                      # Production target Dockerfiles & runtime boundary assertions
└── docker-compose.yml           # Local multi-region clustered topology
⚡ Core Runtime Flows1. Multi-Model Chat OrchestrationPlaintext[React Client] ➔ [API Gateway (Read-Only)] ➔ [Supervisor Router] ➔ [Provider Adapter]
                                                     │
                                             (Async Pub/Sub)
                                                     ▼
                                         [Redis Gossip Queue] ➔ [P2P Swarm]
2. Guarded Staged Patching (Sentinel Flow)Detect: code_healer.py captures an exception state or schema drift.Stage: A SentinelPatchRequest is compiled, encrypted, and saved as PENDING_APPROVAL.Assert: The production environment stays untouched; no code mutations occur automatically.Approve: An administrator provides a time-bound HMAC payload signature to /api/sentinel/approve-patch to cleanly execute the file write.🛠️ Local Development SetupPrerequisitesDocker Engine & Docker Compose v2Python 3.11+ / Node.js 18+ (for running bare-metal components outside containers)1. Configure EnvironmentCreate a .env file in the root directory:Code snippet# Core API Gateways
JWT_SECRET=your_super_secret_jwt_key
AURA_ALLOWED_ORIGINS=http://localhost:5173
AURA_ENVIRONMENT=development

# Multi-Region Infrastructure Connections
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:26257/aura_network
REDIS_URL=redis://localhost:6379/0

# Protected AI Model Credentials
GEMINI_API_KEY=your_gemini_api_key
OPENROUTER_DEFAULT_KEY=your_openrouter_api_key

# Sentinel Cryptographic Secrets
AURA_SENTINEL_MUTATION_ENABLED=true
AURA_SENTINEL_ADMIN_HMAC_SECRET=your_admin_signing_secret
AURA_SENTINEL_TOKEN=your_sentinel_auth_token
2. Spin Up the Local SwarmTo instantiate the entire mesh architecture locally (including multiple Cockroach nodes and workers):Bashdocker compose up -d --build
Verify that all system segments are running healthy:Bashdocker compose ps
curl http://localhost:8000/health
🛡️ Production Security ArchitectureSecurity LayerImplemented MechanismsEdge & FrontendAutomated payload request signing, client-side AES crypto storage, runtime token validation.API BoundaryRead-Only container runtime constraints, strict CORS isolation, automated cryptographic header enforcement.PersistenceCockroachDB serializable transaction retry handlers, localized region-prefixed UUIDv7 primary keys.Execution ShieldStrict root directory traversal bans (.. rejection), automated HMAC verification for system modifications.📈 Observability & TracingAURA utilizes standardized OpenTelemetry contextual propagation hooks across service lines. When a chat interaction issues an async event tracking down into the Redis orchestration layers, the parent trace contexts are automatically injected into the message envelopes—ensuring contiguous visibility inside your target OTLP monitoring engines.
