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

Canonical workflow:

```text
Implement → checkpoint → push → PR → CI → independent review → merge → main
```

- Default branch: `main` — integrated, reviewable, CI-verified project state
- GitHub is the durable collaboration/integration boundary; Cursor and Cursor Worker are implementation environments
- Branch model: `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, `wip/<desc>`
- Feature/fix/chore are for changes intended to reach `main`; `wip/` is for durable incomplete checkpoints
- Prefer pull requests for integration; do not push directly to `main`
- Do not force-push or rewrite shared history by default
- Never use `git reset --hard`, `git clean -fd`, or force-push without explicit authorization
- Never commit secrets, `.env` files, or personal PDF samples
- Preserve dirty WIP that is not yours; do not assume a dirty tree belongs to this session

CI: GitHub Actions `.github/workflows/ci.yml` — jobs `backend` (`pytest`) and `frontend` (`npm ci`, `npm run lint`, `npm run build`). Do not disable failing checks to make CI green.

PRs should include: What changed, Why, Validation, Risk / impact, Known limitations. A template lives at `.github/PULL_REQUEST_TEMPLATE.md`.

### Independent review

Grok (and/or another independent reviewer) is a review layer **after CI**, not a substitute for it. Prefer it for infrastructure, security, data, migrations, and other high-impact changes. Trivial documentation changes may use reduced review depth. Humans remain the merge authority. There is no automated Grok merge gate in this repository.

### Worker reporting

Worker checkout: `/data/projects/worker/JaarrekeningAnalyzer`. Interactive checkout: `/data/projects/active/JaarrekeningAnalyzer`. Do not modify the other tree.

When Worker (or an agent) completes a change, report: repository, branch, commit SHA, files changed, checks run, CI status when known, remaining issues.

Worker must not destroy pre-existing WIP, force-push, bypass CI, silently merge important changes, commit secrets, or assume all dirty files belong to Worker.

## Important Constraints

- `ADMIN_TOKEN` gates live configuration writes; if unset, writes stay disabled (see backend lifespan warning).
- Do not commit secrets, `.env`, or uploaded PDF samples with personal data.
- Do not deploy or expose the analyzer publicly unless explicitly requested.

## AI-Agent-Specific Rules

- Never expose or commit secrets.
- Prefer `pytest` + `frontend` lint/build as verification.
- Do not assume Worker and interactive checkouts are the same tree — Worker uses `/data/projects/worker/JaarrekeningAnalyzer`; interactive uses `/data/projects/active/JaarrekeningAnalyzer`.
- Keep changes scoped; do not “clean up” unrelated dirty trees in other projects.
