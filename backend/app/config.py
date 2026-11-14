from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")
    database_url: str = f"sqlite:///{PROJECT_ROOT / 'data/aimo.db'}"
    catalog_path: Path = PROJECT_ROOT / "data/catalog.db"
    aimo_mode: Literal["live", "fixture", "replay"] = "live"
    aimo_api_key: str = ""
    aimo_base_url: str = "https://junction26.valioaimo.fi"
    replay_path: Path = PROJECT_ROOT / "data/replay.json"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    cookie_secure: bool = False
    preview_minutes: int = 10
    max_concurrent_jobs: int = 4
    demo_session_hours: int = 24


@lru_cache
def get_settings() -> Settings:
    return Settings()
