from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
import re
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
FIXTURE_PATH = DATA_DIR / "worldcup_2026_openfootball.json"
RATINGS_PATH = DATA_DIR / "team_ratings.json"
SPAIN_SUMMER_TIME = timezone(timedelta(hours=2))


@dataclass(frozen=True)
class Match:
    match_id: int
    round: str
    date: str
    time: str
    home_token: str
    away_token: str
    ground: str
    group: str | None = None

    @property
    def is_knockout(self) -> bool:
        return self.group is None

    @property
    def group_letter(self) -> str | None:
        if not self.group:
            return None
        return self.group.replace("Group ", "").strip()

    @property
    def spain_datetime(self) -> datetime | None:
        return _to_spain_datetime(self.date, self.time)

    def to_public_dict(self) -> dict[str, Any]:
        spain_dt = self.spain_datetime
        return {
            "match_id": self.match_id,
            "round": self.round,
            "date": self.date,
            "time": self.time,
            "spain_date": spain_dt.strftime("%Y-%m-%d") if spain_dt else None,
            "spain_time": spain_dt.strftime("%H:%M") if spain_dt else None,
            "home_team": self.home_token,
            "away_team": self.away_token,
            "group": self.group,
            "ground": self.ground,
            "is_knockout": self.is_knockout,
        }


def _assigned_match_id(index: int, raw: dict[str, Any]) -> int:
    if "num" in raw:
        return int(raw["num"])
    if raw["round"] == "Match for third place":
        return 103
    if raw["round"] == "Final":
        return 104
    return index


def _to_spain_datetime(date_value: str, time_value: str) -> datetime | None:
    match = re.fullmatch(r"(\d{2}):(\d{2}) UTC([+-]\d{1,2})(?::?(\d{2}))?", time_value)
    if not match:
        return None
    hour, minute, offset_hour, offset_minute = match.groups()
    offset_hours = int(offset_hour)
    offset_minutes = int(offset_minute or "0")
    if offset_hours < 0:
        offset_minutes *= -1
    source_tz = timezone(timedelta(hours=offset_hours, minutes=offset_minutes))
    source_dt = datetime.fromisoformat(date_value).replace(
        hour=int(hour),
        minute=int(minute),
        tzinfo=source_tz,
    )
    # El Mundial 2026 se juega en junio/julio, cuando la España peninsular está en CEST.
    return source_dt.astimezone(SPAIN_SUMMER_TIME)


@lru_cache(maxsize=1)
def load_matches() -> list[Match]:
    with FIXTURE_PATH.open(encoding="utf-8") as fh:
        payload = json.load(fh)

    matches: list[Match] = []
    for index, raw in enumerate(payload["matches"], start=1):
        matches.append(
            Match(
                match_id=_assigned_match_id(index, raw),
                round=raw["round"],
                date=raw["date"],
                time=raw["time"],
                home_token=raw["team1"],
                away_token=raw["team2"],
                group=raw.get("group"),
                ground=raw["ground"],
            )
        )
    return sorted(matches, key=lambda match: match.match_id)


@lru_cache(maxsize=1)
def load_ratings() -> dict[str, float]:
    with RATINGS_PATH.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    return {team: float(meta["elo"]) for team, meta in payload["teams"].items()}


def build_groups(matches: list[Match] | None = None) -> dict[str, list[str]]:
    group_matches = matches or load_matches()
    groups: dict[str, list[str]] = {}
    for match in group_matches:
        if not match.group_letter:
            continue
        teams = groups.setdefault(match.group_letter, [])
        for team in (match.home_token, match.away_token):
            if team not in teams:
                teams.append(team)
    return dict(sorted(groups.items()))


def all_teams(matches: list[Match] | None = None) -> list[str]:
    groups = build_groups(matches)
    return sorted({team for teams in groups.values() for team in teams})


def data_version() -> str:
    stat = FIXTURE_PATH.stat()
    return f"openfootball-2026:{int(stat.st_mtime)}"
