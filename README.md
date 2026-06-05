# World Cup 2026 Predictor

Editable prediction workbench for the 2026 FIFA World Cup.

Users can enter group-stage and knockout results, lock those scores as factual, and run a Monte Carlo prediction for the remaining tournament. Scenarios are encoded in the URL hash so they can be shared without accounts or a database.

## Stack

- `backend/`: FastAPI, Pydantic, NumPy simulation engine.
- `frontend/`: React + TypeScript + Vite.
- `data/`: committed tournament fixture and seed rating snapshots.
- `Dockerfile`: single deployable service; FastAPI serves the API and built frontend.

## Local Development

Use a repo-local `.venv` for backend development. This keeps the project dependencies separate from the global Miniforge/base Python environment.

Backend:

```powershell
C:\Users\DavidPerezCaballero\miniforge3\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload
```

Backend tests:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to `http://127.0.0.1:8000`.

Docker:

```powershell
docker compose up --build
```

Open `http://localhost:8000`.

## API

- `GET /api/tournament`: fixtures, groups, teams, ratings, model metadata.
- `POST /api/predict`: runs prediction with locked factual results.
- `POST /api/refresh-data`: disabled unless `ALLOW_REFRESH=1`.

Prediction request shape:

```json
{
  "facts": [
    {
      "match_id": 1,
      "home_score": 2,
      "away_score": 0,
      "source": "manual"
    },
    {
      "match_id": 73,
      "home_score": 1,
      "away_score": 1,
      "knockout_winner": "home",
      "source": "manual"
    }
  ],
  "settings": {
    "simulations": 20000,
    "seed": 2026
  }
}
```

For tied knockout facts, `knockout_winner` must be `home`, `away`, or a resolved team name.

## Data Sources

- FIFA schedule and rules are used as the official reference.
- `data/worldcup_2026_openfootball.json` comes from `openfootball/worldcup.json`.
- `data/team_ratings.json` is a v1 seed Elo snapshot used by the baseline model.

## Model

The active v1 engine is an Elo-informed Poisson score model. Entered scores override the model completely. Missing matches are simulated, and tied simulated knockout matches are resolved by Elo advancement probability.

The model layer is isolated in `backend/app/modeling.py` so historical ML training/backtesting can be added without changing the frontend/API contract.
