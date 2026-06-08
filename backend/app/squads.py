from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from .data_loader import DATA_DIR, build_groups, data_version
from .simulator import ScenarioError


FIFA_SQUAD_PDF_URL = "https://fdp.fifa.org/assetspublic/ce281/pdf/SquadLists-English.pdf"
SQUAD_PDF_PATH = DATA_DIR / "squadlists_fifa_2026.pdf"
SQUAD_TEXT_PATH = DATA_DIR / "squadlists_fifa_2026.txt"
SQUAD_JSON_PATH = DATA_DIR / "squads_fifa_2026.json"

TEAM_RE = re.compile(r"^\s*([^\n()]+?)\s+\(([A-Z]{3})\)\s*$", re.MULTILINE)
PLAYER_RE = re.compile(
    r"^\s*(\d{1,2})\s+(GK|DF|MF|FW)\s+(.+?)\s{2,}(.+?)\s{2,}(.+?)\s{2,}(.+?)\s{2,}"
    r"(\d{2}/\d{2}/\d{4})\s+(.+?)\s{2,}(\d{3})\s*$",
    re.MULTILINE,
)
COACH_RE = re.compile(r"^\s*Head coach\s+(.+?)\s{2,}(.+?)\s{2,}(.+?)\s{2,}(.+?)\s*$", re.MULTILINE)
PDF_TEAM_NAME_TO_APP_NAME = {
    "Bosnia And Herzegovina": "Bosnia & Herzegovina",
    "Cabo Verde": "Cape Verde",
    "Congo DR": "DR Congo",
    "Côte D'Ivoire": "Ivory Coast",
    "Czechia": "Czech Republic",
    "IR Iran": "Iran",
    "Korea Republic": "South Korea",
    "Türkiye": "Turkey",
}


def squads_payload() -> dict[str, Any]:
    if not SQUAD_JSON_PATH.exists():
        raise ScenarioError("El snapshot de convocatorias no existe. Ejecuta refresh_squad_snapshot().")

    payload = json.loads(SQUAD_JSON_PATH.read_text(encoding="utf-8"))
    teams = payload.get("teams", [])
    if not teams:
        raise ScenarioError("El snapshot de convocatorias esta vacio.")
    return payload


def refresh_squad_snapshot() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with urlopen(FIFA_SQUAD_PDF_URL, timeout=30) as response:
        SQUAD_PDF_PATH.write_bytes(response.read())

    subprocess.run(
        ["pdftotext", "-layout", str(SQUAD_PDF_PATH), str(SQUAD_TEXT_PATH)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = parse_squad_text(SQUAD_TEXT_PATH.read_text(encoding="utf-8"))
    SQUAD_JSON_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return SQUAD_JSON_PATH


def parse_squad_text(text: str) -> dict[str, Any]:
    groups_by_team = _groups_by_team()
    teams = []

    for page in text.split("\f"):
        team_match = _team_match_for_page(page)
        if not team_match:
            continue

        team_name, team_code = team_match
        app_team_name = PDF_TEAM_NAME_TO_APP_NAME.get(_clean_text(team_name), _clean_text(team_name))
        players = [_player_from_match(match) for match in PLAYER_RE.finditer(page)]
        if len(players) != 26:
            raise ScenarioError(f"La convocatoria de {team_name} tiene {len(players)} jugadores; se esperaban 26.")

        coach_match = COACH_RE.search(page)
        coach = None
        if coach_match:
            coach = {
                "role": "Head coach",
                "name": _clean_text(coach_match.group(1)),
                "first_names": _clean_text(coach_match.group(2)),
                "last_names": _clean_text(coach_match.group(3)),
                "nationality": _clean_text(coach_match.group(4)),
            }

        teams.append(
            {
                "team": app_team_name,
                "fifa_team_name": _clean_text(team_name),
                "code": team_code,
                "group": groups_by_team.get(app_team_name),
                "coach": coach,
                "players": players,
            }
        )

    if len(teams) != 48:
        raise ScenarioError(f"El PDF produjo {len(teams)} selecciones; se esperaban 48.")

    return {
        "source": {
            "name": "FIFA Squad Lists - FIFA World Cup 2026",
            "url": FIFA_SQUAD_PDF_URL,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "data_version": data_version(),
        "teams": teams,
    }


def _team_match_for_page(page: str) -> tuple[str, str] | None:
    for match in TEAM_RE.finditer(page):
        team_name = _clean_text(match.group(1))
        if team_name and "FIFA World Cup" not in team_name and team_name != "SQUAD LIST":
            return team_name, match.group(2)
    return None


def _player_from_match(match: re.Match[str]) -> dict[str, Any]:
    return {
        "number": int(match.group(1)),
        "position": match.group(2),
        "player_name": _clean_text(match.group(3)),
        "first_names": _clean_text(match.group(4)),
        "last_names": _clean_text(match.group(5)),
        "shirt_name": _clean_text(match.group(6)),
        "date_of_birth": _clean_text(match.group(7)),
        "club": _clean_text(match.group(8)),
        "height_cm": int(match.group(9)),
    }


def _groups_by_team() -> dict[str, str]:
    return {
        team: group
        for group, teams in build_groups().items()
        for team in teams
    }


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
