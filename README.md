# Galley Control — Intelligent Campus Canteen Management Platform

> **Tagline:** Beyond Food Ordering — Towards an Intelligent, Self-Optimising Campus Canteen.

## Architecture Overview
Galley Control is a full-stack SaaS platform built with **React + Vite + Tailwind CSS**, **FastAPI + SQLAlchemy 2.0 + Alembic**, and **PostgreSQL** (with local SQLite fallback for isolated development/tests), integrating **1 Central Orchestrator Agent** and **8 Specialised Agents** (`Ordering`, `Inventory`, `Security`, `Queue`, `Support`, `Analytics`, `Outlet Performance`, and `Review & Feedback`).

---

## Key Production Features Implemented

### 1. Real Conversational AI Assistant (`Central Orchestrator`)
- **Multi-Turn Conversation Persistence:** Conversations and messages are persisted per user in `ai_conversations` and `ai_messages` (`GET /api/agents/conversations`, `GET/DELETE /api/agents/conversations/{id}`).
- **Configurable Live LLM Integration + Streaming:** Supports `gemini`, `openai`, `groq`, `openrouter`, and `anthropic` via `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL` environment variables (never exposed to browser code), plus SSE token streaming (`POST /api/agents/chat/stream`) and per-user rate limiting.
- **Role-Scoped Grounded Backend Tools:** LLM calls query verified live database tools across existing agents:
  - **All Roles:** Fuzzy/typo-tolerant menu & price search (`Ordering Agent`), live outlet queue waits (`Queue Agent`), ordering & QR pickup procedures (`Support Agent`).
  - **Students:** Live status & QR pass state for their own orders.
  - **Outlet Managers / Admins:** Scoped inventory & stockout reports (`Inventory Agent`), customer feedback & category trends (`Review & Feedback Agent`), outlet bottleneck KPIs (`Outlet Performance Agent`), and campus analytics (`Analytics Agent`).
- **Transparent Fallback:** If `LLM_API_KEY` is unconfigured or a provider times out/errors, deterministic fallback answers from live database queries are returned with an explicit `fallback_reason` badge rather than fabricated AI text.

### 2. Real User Registration, Auth Security & RBAC
- **Student Public Registration (`/register`, `POST /api/auth/register`):** Validates username format, email uniqueness, password strength (>= 8 chars, letter + digit), and confirmation. Public sign-up always forces `role = "student"` server-side.
- **Role-Based Dashboards:**
  - **Student (`/student`):** Ordering, smart substitutes, group/scheduled orders, simulated payment, QR pass, tracking/cancellations, AI assistant, reviews.
  - **Outlet Manager (`/manager`, `/manager/scanner`):** Outlet-scoped queue transitions (`PLACED → PREPARING`), stock updates with `inventory_movements` logging, review resolution, AI assistant, and counter QR scanner with webcam auto-start & explicit Start/Stop Camera controls.
  - **System Admin (`/admin`, `/admin/outlets`, `/admin/scanner`):** 8-agent campus intelligence, outlet configuration (`OPEN`/`BUSY`/`CLOSED`, staff, SLA), manager account provisioning (`POST /api/admin/users`, `PATCH /api/admin/users/{id}`), security incident governance, and audit logs (`audit_logs`).
- **Session & Brute-Force Protection:** `bcrypt` password hashing, HTTP-only session cookies (`gc_session`, `credentials: "include"`), persistent DB-backed login rate limiting (`429`), and single-use password reset flow (`/forgot-password`, `/reset-password`) with SMTP support.

### 3. Multi-Tenant Public Campus SaaS & Strict Tenant Isolation
- **Organisation Onboarding (`/register-org`, `POST /api/organisations/register`):** Any college, university, or canteen group can apply for an isolated tenant (`organisations` table with `PENDING_APPROVAL` status) alongside its primary Organisation Manager (`outlet_id = null`).
- **Platform Admin Governance (`/admin`, `/admin/outlets`, `GET/PATCH /api/admin/organisations`):** Platform Administrators (`role = "admin"`, `organisation_id = null`) approve, suspend, or reject onboarding requests, switch platform-wide or `?organisation_id=` analytics, and configure outlets across tenants. Suspending an organisation immediately blocks logins and active sessions for its managers and students (`403`).
- **Multi-Outlet Organisation Managers & Outlet Supervisors (`/manager`):** Approved Organisation Managers can add multiple outlets (`POST /api/dashboard/outlets`), toggle `OPEN`/`BUSY`/`CLOSED` status, publish outlet menu items (`POST /api/dashboard/outlet/menu`), provision outlet-assigned managers (`POST /api/dashboard/org/managers`), and view organisation-wide 8-agent telemetry (`GET /api/dashboard/org-summary`). Outlet-assigned managers remain restricted to their single assigned outlet within their organisation.
- **Tenant-Isolated Students & Chatbot AI:** Public student sign-up (`/register`) binds students to an `ACTIVE` organisation from `GET /api/organisations/public`. Every order, catalog lookup, group order (`GRP-*`), QR verification, review, audit log, and Gemini/LLM chatbot tool call derives and validates `organisation_id` exclusively from the authenticated server session — never trusting client-supplied tenant IDs.

### 4. PostgreSQL Schema, Alembic Migrations & Dev/Prod Separation
- **SQLAlchemy 2.0 + Alembic (`backend/alembic/`):** Full relational tables for `organisations`, `roles`, `permissions`, `role_permissions`, `users`, `user_sessions`, `password_reset_tokens`, `auth_rate_limits`, `outlets`, `menu_items`, `inventory_movements`, `orders`, `order_items`, `qr_tokens`, `security_events`, `reviews`, `ai_conversations`, `ai_messages`, `agent_activity_logs`, `ai_recommendations`, `outlet_performance_snapshots`, and `audit_logs`, with `0002_multi_tenant_organisations` providing non-destructive `organisation_id` backfill for legacy single-tenant databases.
- **Environment Separation:** `APP_ENV=production` enforces `DATABASE_URL` (PostgreSQL) and strong `AUTH_SECRET` at startup, removes development credential hints from `/login`, and disables `/api/demo/reset` (`403`).
- **SQLite → PostgreSQL Migration Script:**
  ```bash
  cd backend
  python scripts/migrate_sqlite_to_postgres.py --sqlite ./galley_control.db --postgres-url "$DATABASE_URL"
  ```

---

## Local Development Setup

### 1. Environment Configuration
```bash
cp .env.example backend/.env
```
Add your `LLM_API_KEY` (e.g. Gemini or OpenAI) and optional `DATABASE_URL` in `backend/.env`.

### 2. Backend Launch
```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
Run tests:
```bash
cd backend
pytest -v
```

### 3. Frontend Launch
```bash
cd frontend
npm install
npm run dev
```

---

## Production Deployment Guide (Render + Managed PostgreSQL)

1. **Managed PostgreSQL (Neon / Supabase / Render Postgres):**
   - Create a PostgreSQL database and copy its `DATABASE_URL`.
   - Run `alembic upgrade head` against `DATABASE_URL`.
   - Provision initial admin: `python -m app.cli create-admin --email admin@yourdomain.com --username admin --password "<StrongPass>"` (or set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` once).
   - Seed campus outlets/menus cleanly without demo users: `python -m app.cli seed-catalog`.
2. **Render (frontend and backend in one service):**
   - Create a Render Blueprint from the repository root using `render.yaml`. The root `Dockerfile` builds the React frontend and packages it with FastAPI; Render serves the UI and API from the same URL.
   - Set `APP_ENV=production`, `DATABASE_URL`, `AUTH_SECRET`, `LLM_PROVIDER`, `LLM_API_KEY`, `CORS_ORIGINS`, `FRONTEND_APP_URL`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, and optional `SMTP_*` variables. Set `FRONTEND_APP_URL` and `CORS_ORIGINS` to the Render service URL.
   - The service root serves the frontend. API endpoints remain under `/api`, and client-side routes such as `/login` are served by the React app.

To host the frontend separately on Vercel or Netlify instead, use `frontend/vercel.json` or `frontend/netlify.toml` and replace `REPLACE_WITH_YOUR_BACKEND_DOMAIN` with the deployed FastAPI hostname.
