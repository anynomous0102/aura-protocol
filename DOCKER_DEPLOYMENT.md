# AURA Docker Run Guide

## Local Docker

1. Install Docker Desktop.
2. Keep your real keys in `backend/.env`.
3. Start both services:

```bash
docker compose up --build
```

4. Open the app:

```text
http://localhost:3000
```

The backend API runs at:

```text
http://localhost:8000
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

## Useful Commands

Stop containers:

```bash
docker compose down
```

Restart:

```bash
docker compose up -d
```

View backend logs:

```bash
docker compose logs -f backend
```

Back up user data:

```bash
tar -czf aura-backup.tar.gz backend/data
```

## Production Note

For an online Docker host, set `VITE_BACKEND_URL` to your public backend URL while building the frontend, for example:

```bash
docker compose build --build-arg VITE_BACKEND_URL=https://your-backend-domain.com frontend
```

Set API keys as host/platform environment variables or keep them in a private `.env` file on the server. Never commit `backend/.env`.
