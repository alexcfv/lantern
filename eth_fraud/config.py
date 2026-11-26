import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    agents_base_url: str
    agents_timeout_seconds: float
    port: int
    goplus_base_url: str
    goplus_access_token: str
    goplus_timeout_seconds: float
    chain_id: str
    model_backend: str
    model_reference_date: str | None


def load_settings() -> Settings:
    return Settings(
        agents_base_url=os.getenv("AGENTS_BASE_URL", "http://127.0.0.1:3000"),
        agents_timeout_seconds=float(os.getenv("AGENTS_TIMEOUT_SECONDS", "10")),
        port=int(os.getenv("PORT", "5000")),
        goplus_base_url=os.getenv("GOPLUS_BASE_URL", "https://api.gopluslabs.io"),
        goplus_access_token=os.getenv("GOPLUS_ACCESS_TOKEN", ""),
        goplus_timeout_seconds=float(os.getenv("GOPLUS_TIMEOUT_SECONDS", "5")),
        chain_id=os.getenv("CHAIN_ID", "1"),
        model_backend=os.getenv("MODEL_BACKEND", "tabicl"),
        model_reference_date=os.getenv("MODEL_REFERENCE_DATE") or None,
    )
