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
from .squads import refresh_squad_snapshot, squads_payload
from .team_stories import team_stories_payload


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
WORLD_CUP_LOGO = DATA_DIR / "weare26.png"
WORLD_CUP_INTRO_ART = DATA_DIR / "worldcup_intro_art.jpg"
WORLD_CUP_INTRO_BG = DATA_DIR / "image.png"
WORLD_MAP_BG = DATA_DIR / "world_map_bg.png"

app = FastAPI(title="Predictor Mundial 2026", version="0.1.0")

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


@app.get("/api/squads")
def get_squads() -> dict:
    try:
        return squads_payload()
    except ScenarioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/team-stories")
def get_team_stories() -> dict:
    try:
        return team_stories_payload()
    except ScenarioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/refresh-data")
def refresh_data() -> dict[str, str]:
    if os.getenv("ALLOW_REFRESH") != "1":
        raise HTTPException(status_code=403, detail="La actualización de datos está desactivada en este despliegue.")
    path = refresh_fixture_snapshot()
    baseline_path = refresh_baseline_snapshot()
    squads_path = refresh_squad_snapshot()
    return {"status": "ok", "path": str(path), "baseline_path": str(baseline_path), "squads_path": str(squads_path)}


@app.get("/weare26.png")
def get_world_cup_logo() -> FileResponse:
    if not WORLD_CUP_LOGO.exists():
        raise HTTPException(status_code=404, detail="Logo no encontrado.")
    return FileResponse(WORLD_CUP_LOGO, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/worldcup_intro_art.jpg")
def get_world_cup_intro_art() -> FileResponse:
    if not WORLD_CUP_INTRO_ART.exists():
        raise HTTPException(status_code=404, detail="Imagen de portada no encontrada.")
    return FileResponse(WORLD_CUP_INTRO_ART, media_type="image/jpeg")


@app.get("/worldcup_intro_bg.png")
def get_world_cup_intro_bg() -> FileResponse:
    if not WORLD_CUP_INTRO_BG.exists():
        raise HTTPException(status_code=404, detail="Imagen de portada no encontrada.")
    return FileResponse(WORLD_CUP_INTRO_BG, media_type="image/png")


@app.get("/world_map_bg.png")
def get_world_map_bg() -> FileResponse:
    if not WORLD_MAP_BG.exists():
        raise HTTPException(status_code=404, detail="Mapa no encontrado.")
    return FileResponse(WORLD_MAP_BG, media_type="image/png")


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def missing_api_route(full_path: str) -> dict[str, str]:
    raise HTTPException(status_code=404, detail=f"Ruta de API no encontrada: /api/{full_path}")


@app.get("/{full_path:path}")
def serve_frontend(full_path: str) -> FileResponse:
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="La build del frontend no está disponible. Ejecuta npm run build.")
    return FileResponse(index)
