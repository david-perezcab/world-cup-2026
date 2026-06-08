from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .data_loader import DATA_DIR
from .simulator import ScenarioError


TEAM_STORIES_PATH = DATA_DIR / "team_stories.json"


def team_stories_payload() -> dict[str, Any]:
    if not TEAM_STORIES_PATH.exists():
        raise ScenarioError("El snapshot de historias por seleccion no existe.")

    payload = json.loads(TEAM_STORIES_PATH.read_text(encoding="utf-8"))
    stories = payload.get("stories", [])
    if len(stories) != 48:
        raise ScenarioError(f"El snapshot de historias tiene {len(stories)} selecciones; se esperaban 48.")

    missing_codes = [story.get("team", "sin nombre") for story in stories if not story.get("code")]
    if missing_codes:
        raise ScenarioError(f"Historias sin codigo FIFA: {', '.join(missing_codes)}")

    return payload
