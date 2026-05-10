FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AURA_DATA_DIR=/app/backend/data
RUN apt-get update && apt-get install -y build-essential python3-dev curl && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.docker.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
WORKDIR /app/backend
RUN mkdir -p /app/backend/data/docs /app/backend/data/chroma_db
EXPOSE 8000
# $PORT is provided by most hosts automatically; default to 8000 locally.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
