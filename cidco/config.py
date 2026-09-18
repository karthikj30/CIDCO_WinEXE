"""Where the agent keeps what the installer chose.

One small JSON file next to the install, so the agent can start up already
knowing the export folder and the schedule the user picked.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .schedule import DEFAULT_SECONDS

APP_NAME = "CIDCO AQI Agent"


def config_dir() -> Path:
    """%LOCALAPPDATA%\\CIDCO-AQI-Agent on Windows, ~/.cidco-aqi-agent elsewhere."""
    override = os.environ.get("CIDCO_AGENT_HOME")
    if override:
        return Path(override)
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "CIDCO-AQI-Agent"
    return Path.home() / ".cidco-aqi-agent"


def config_path() -> Path:
    return config_dir() / "settings.json"


@dataclass
class Settings:
    """Everything the installer collects, plus what the agent remembers."""

    role: str = "architect"
    # The folder the architect's AQI export lands in.
    csv_folder: str = ""
    interval_seconds: int = DEFAULT_SECONDS
    # Connection details — filled in on the agent's first run.
    designated_ip: str = ""
    port: int = 2222
    username: str = ""
    company_id: str = ""
    installed_at: str = ""
    # Never written to disk; kept only for the running session.
    password: str = field(default="", repr=False, compare=False)

    def to_json(self) -> dict:
        data = asdict(self)
        data.pop("password", None)  # the password is never stored
        return data


def load() -> Settings:
    """Reads the saved settings, or sensible defaults on a fresh machine."""
    path = config_path()
    if not path.exists():
        return Settings()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Settings()

    known = {f for f in Settings().__dataclass_fields__}  # type: ignore[attr-defined]
    return Settings(**{k: v for k, v in raw.items() if k in known and k != "password"})


def save(settings: Settings) -> Path:
    """Writes the settings, creating the folder on first install."""
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings.to_json(), indent=2), encoding="utf-8")
    return path


def is_installed() -> bool:
    return config_path().exists()
