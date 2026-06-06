from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .models import PredictRequest
from .refresh_data import refresh_baseline_snapshot, refresh_fixture_snapshot
from .simulator import ScenarioError, baseline_prediction_payload, predict, tournament_payload


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

app = FastAPI(title="World Cup 2026 Predictor", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/tournament")
def get_tournament() -> dict:
    try:
        return tournament_payload()
    except ScenarioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/predict")
def post_predict(request: PredictRequest) -> dict:
    try:
        return predict(request)
    except ScenarioError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/baseline")
def get_baseline() -> dict:
    try:
        return baseline_prediction_payload()
    except ScenarioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/refresh-data")
def refresh_data() -> dict[str, str]:
    if os.getenv("ALLOW_REFRESH") != "1":
        raise HTTPException(status_code=403, detail="Data refresh is disabled for this deployment.")
    path = refresh_fixture_snapshot()
    baseline_path = refresh_baseline_snapshot()
    return {"status": "ok", "path": str(path), "baseline_path": str(baseline_path)}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def missing_api_route(full_path: str) -> dict[str, str]:
    raise HTTPException(status_code=404, detail=f"API route not found: /api/{full_path}")


@app.get("/{full_path:path}")
def serve_frontend(full_path: str) -> FileResponse:
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="Frontend build is not available. Run npm run build.")
    return FileResponse(index)
