# Jaarrekening Analyzer

De Jaarrekening Analyzer is een lokale webapplicatie waarmee je een Belgische jaarrekening-PDF kunt uploaden en automatisch financiële inzichten krijgt. De app leest tekst-PDF's in NBB-stijl (zoals gedeponeerd bij de Nationale Bank van België), haalt daar de MAR-codes en bedragen uit, en berekent daarop financiële ratio's. Denk aan liquiditeit, solvabiliteit en rentabiliteit.

Het resultaat toon je in een overzichtelijke interface: de geëxtraheerde balans (activa en passiva), de resultatenrekening, en de berekende ratio's met formule en ontbrekende codes waar data ontbreekt. Alles draait lokaal op je eigen machine; er is geen database en geen cloud-upload.


## Production Docker deployment

See [`DEPLOY.md`](DEPLOY.md) for the Compose-based production layout (Caddy +
FastAPI + `ratios-data` volume), exact-commit checkout, secrets handling, and
health checks. That document does not auto-deploy any host.

## Vereisten

- Python 3.11+
- Node.js 18+ (nodig vanaf frontend-stappen)

## Voortgang

| Stap | Onderdeel | Status |
|------|-----------|--------|
| 1 | Projectstructuur + README | klaar |
| 2 | Minimale FastAPI-app (`/api/health`) | klaar |
| 3 | Pydantic schemas | klaar |
| 4 | PDF text detector | klaar |
| 5 | PDF extractor | klaar |
| 6 | MAR aggregator | klaar |
| 7 | Ratio engine + `ratios.yaml` | klaar |
| 8 | Analyzer pipeline | klaar |
| 9 | API routes (`POST /api/analyze`) | klaar |
| 10 | Backend tests | klaar |
| 11 | Frontend scaffold + types | klaar |
| 12 | API client + Vite proxy | klaar |
| 13 | UploadZone | klaar |
| 14 | StatementTable | klaar |
| 15 | RatioDashboard | klaar |
| 16 | App.tsx wiring | klaar |
| 17 | End-to-end test | klaar |

## Snel starten (backend)

```powershell
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

API-docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Snel starten (frontend)

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Live ratio-configuratie

De gebundelde `backend/config/ratios.yaml` is de standaard. Na de eerste start leeft de actieve configuratie in het override-bestand (`RATIOS_CONFIG_PATH`, in Docker `/data/ratios.yaml` op volume `ratios-data`). Testers wijzigen ratio's in het tabblad **Ratio-configuratie** en klikken **Opslaan**. Dat vereist geen GitHub-edit en geen Docker-rebuild.

Schrijfbewerkingen gebruiken header `X-Admin-Token`. Zet `ADMIN_TOKEN=<random-secret>` in de omgeving (zie `.env.example`). Er is geen standaardtoken.

## Structuur (nu)

```
jaarrekening-analyzer/
├── README.md
├── backend/
│   ├── config/
│   │   └── ratios.yaml
│   ├── requirements.txt
│   └── app/ ...
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx          # orchestrator: upload → tabs → sessionStorage
        ├── index.css
        ├── types.ts         # spiegelt backend AnalysisResult
        ├── api/client.ts    # POST /api/analyze via FormData
        ├── components/
        │   ├── UploadZone.tsx
        │   ├── StatementTable.tsx
        │   └── RatioDashboard.tsx
        └── utils/format.ts  # nl-BE bedragen + ratio units
```

## Git & GitHub

```powershell
git add .
git status
git commit -m "korte beschrijving van je wijziging"
git push
```

Remote: [github.com/QuintenDes/jaarrekening-analyzer](https://github.com/QuintenDes/jaarrekening-analyzer)
