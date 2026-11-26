import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    agents_base_url: str
    agents_timeout_seconds: float
    port: int


def load_settings() -> Settings:
    return Settings(
        agents_base_url=os.getenv("AGENTS_BASE_URL", "http://127.0.0.1:3000"),
        agents_timeout_seconds=float(os.getenv("AGENTS_TIMEOUT_SECONDS", "10")),
        port=int(os.getenv("PORT", "5000")),
    )
