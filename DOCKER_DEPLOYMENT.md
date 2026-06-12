# AURA Docker and Render Deployment

## Architecture

The root `Dockerfile` builds the full application:

- Vite/React frontend is built in a Node stage.
- FastAPI backend is installed in a Python runtime stage.
- Nginx serves the frontend and proxies `/api/*` requests to Uvicorn.
- Runtime data is stored in `AURA_DATA_DIR`, defaulting to `/app/backend/data`.

This gives Render one public web service and one public port while still running both parts of the app.

## Local Docker

1. Install Docker Desktop.
2. Keep real API keys in `backend/.env`.
3. Start the full-stack app:

```bash
docker compose up --build
```

4. Open the app:

```text
http://localhost:3000
```

The backend API is available through the same origin:

```text
http://localhost:3000/api/protocols/status
```

## Persistent User Data

Docker stores backend runtime data here:

```text
backend/data/
```

That folder contains:

```text
backend/data/aura_network.db
backend/data/docs/
backend/data/chroma_db/
```

Do not commit this folder. It contains user sessions, saved nodes, chat metadata, uploads, and vector memory.

## Render

`render.yaml` defines a Docker web service named `aura-fullstack`.

It includes:

- Docker build from the repo root.
- Nginx public port mapped to Render's `PORT`.
- Uvicorn running internally on `BACKEND_PORT`.
- Persistent disk mounted at `/app/backend/data`.
- Generated `JWT_SECRET`.
- Secret API keys marked with `sync: false`.
- Manual preview environments that expire after 7 days.

The service uses the `starter` plan because Render free web services do not support persistent disks. To deploy on the free plan, remove the `disk` block, change `plan` to `free`, and expect local SQLite/vector/upload data to reset on redeploys or spin-downs.

## Useful Commands

Stop containers:

```bash
docker compose down
```

Restart:

```bash
docker compose up -d
```

View logs:

```bash
docker compose logs -f app
```

Back up local runtime data:

```bash
tar -czf aura-backup.tar.gz backend/data
```
