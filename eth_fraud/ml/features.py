import json
from datetime import date
from functools import lru_cache
from pathlib import Path

import numpy as np

from eth_fraud.schemas import AnalyzeRequest

MODEL_DIR = Path(__file__).resolve().parent / "wallet_risk_model"
MAX_DAYS = 512


@lru_cache(maxsize=1)
def load_feature_config(path: Path = MODEL_DIR / "config.json") -> dict:
    return json.loads(Path(path).read_text())


def build_features(request: AnalyzeRequest, reference_date: date | None = None) -> np.ndarray:
    config = load_feature_config()
    reference_date = reference_date or date.today()

    values = {
        "tx_in_count": request.tx_in_count,
        "eth_in": request.eth_in,
        "distinct_in_counterparties": request.distinct_in_counterparties,
        "approval_events": request.approval_events,
        "distinct_token_contracts": request.distinct_token_contracts,
        "has_incoming": int(request.tx_in_count > 0),
        "in_age_days": (reference_date - request.first_in_ts).days,
        "days_since_last_in": (reference_date - request.last_in_ts).days,
        "in_span_days": (request.last_in_ts - request.first_in_ts).days,
    }

    vector = np.array([values[name] for name in config["features"]], dtype=np.float64)
    log_idx = set(config["log_idx"])

    for index in log_idx:
        vector[index] = np.log1p(max(vector[index], 0.0))

    for index in range(len(vector)):
        if index not in log_idx:
            vector[index] = min(max(vector[index], -1.0), float(MAX_DAYS))

    return vector.reshape(1, -1)
