# AGENTS.md

Agent-oriented operating instructions for Jaarrekening Analyzer. Human-facing setup lives in `README.md`.

## Project Overview

Local web app that uploads a Belgian annual-accounts PDF (NBB-style), extracts MAR codes and amounts, and computes financial ratios (liquidity, solvency, profitability). Backend is FastAPI; frontend is React + Vite. No cloud upload and no application database — analysis runs locally.

Canonical GitHub repository: `quintendesaever/jaarrekening-analyzer`.

## Repository Structure

| Path | Role |
|------|------|
| `backend/app/main.py` | FastAPI entry |
| `backend/app/api/` | HTTP routes (`/api/health`, `/api/analyze`, config) |
| `backend/app/pdf/` | PDF detect / extract |
| `backend/app/mar/` | MAR aggregation |
| `backend/app/ratios/` | Ratio engine |
| `backend/app/tables/` | Table validation / store |
| `backend/config/` | `ratios.yaml`, `tables.yaml` |
| `backend/tests/` | pytest suite |
| `frontend/` | React + Vite UI |
| `README.md` | Human setup / progress |

## Development Environment

- **Backend:** Python 3.11+
- **Frontend:** Node.js 18+ (lockfile present under `frontend/`)
- **Package managers:** pip (`backend/requirements.txt`), npm (`frontend/package-lock.json`)

## Development Commands

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # or equivalent
pip install -r requirements.txt
uvicorn app.main:app --reload
pytest
```

Frontend:

```bash
cd frontend
npm ci
npm run dev      # Vite
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

## Coding Conventions

- Keep analysis local — do not add cloud upload or persistence of uploaded PDFs unless explicitly requested.
- Prefer extending existing MAR / ratio / table config over inventing parallel formats.
- Backend tests live under `backend/tests/` and should stay runnable with `pytest`.
- Frontend uses TypeScript; keep `npm run build` clean.

## Git Conventions

- Default branch: `main`
- GitHub is the machine-to-machine handoff boundary for published work
- Use feature/fix branches and pull requests into `main`
- Do not force-push or rewrite shared history by default
- Do not push directly to `main` when branch protection is enabled

## Important Constraints

- `ADMIN_TOKEN` gates live configuration writes; if unset, writes stay disabled (see backend lifespan warning).
- Do not commit secrets, `.env`, or uploaded PDF samples with personal data.
- Do not deploy or expose the analyzer publicly unless explicitly requested.

## AI-Agent-Specific Rules

- Never expose or commit secrets.
- Prefer `pytest` + `frontend` lint/build as verification.
- Do not assume Worker and interactive checkouts are the same tree — Worker uses `/data/projects/worker/JaarrekeningAnalyzer`; interactive uses `/data/projects/active/JaarrekeningAnalyzer`.
- Keep changes scoped; do not “clean up” unrelated dirty trees in other projects.
