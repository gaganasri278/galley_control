FROM node:22-alpine AS frontend-build

WORKDIR /workspace

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend

COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace/backend

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /workspace/frontend/dist /workspace/frontend/dist

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
