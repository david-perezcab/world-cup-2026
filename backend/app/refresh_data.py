from __future__ import annotations

from pathlib import Path
from urllib.request import urlopen

from .data_loader import FIXTURE_PATH


OPENFOOTBALL_2026_JSON = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"


def refresh_fixture_snapshot() -> Path:
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(OPENFOOTBALL_2026_JSON, timeout=30) as response:
        payload = response.read()
    FIXTURE_PATH.write_bytes(payload)
    return FIXTURE_PATH


if __name__ == "__main__":
    print(refresh_fixture_snapshot())
