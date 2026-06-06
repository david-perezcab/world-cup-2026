from __future__ import annotations

from pathlib import Path
from urllib.request import urlopen

from .data_loader import FIXTURE_PATH, load_matches
from .simulator import write_baseline_prediction


OPENFOOTBALL_2026_JSON = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"


def refresh_fixture_snapshot() -> Path:
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(OPENFOOTBALL_2026_JSON, timeout=30) as response:
        payload = response.read()
    FIXTURE_PATH.write_bytes(payload)
    load_matches.cache_clear()
    return FIXTURE_PATH


def refresh_baseline_snapshot() -> Path:
    return write_baseline_prediction()


if __name__ == "__main__":
    print(refresh_fixture_snapshot())
    print(refresh_baseline_snapshot())
