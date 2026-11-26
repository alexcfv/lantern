from datetime import date
from pathlib import Path

import numpy as np
from tabicl import TabICLClassifier

from eth_fraud.ml.features import MODEL_DIR, build_features
from eth_fraud.schemas import AnalyzeRequest, AnalyzeResponse


class TabICLPredictor:
    def __init__(self, model_dir: Path = MODEL_DIR, reference_date: date | None = None) -> None:
        self._reference_date = reference_date
        self._x_context = np.load(model_dir / "X_context.npy")
        self._y_context = np.load(model_dir / "y_context.npy")
        self._model = TabICLClassifier(
            model_path=str(model_dir / "tabicl-classifier-v2.ckpt"),
            allow_auto_download=False,
            kv_cache=True,
        )
        self._model.fit(self._x_context, self._y_context)

    def predict(self, features: AnalyzeRequest) -> AnalyzeResponse:
        probabilities = np.asarray(self._model.predict_proba(build_features(features, self._reference_date)))
        risk_score = float(probabilities[0, 1])
        return AnalyzeResponse(
            address=features.address,
            fraud_probability=risk_score,
            verdict="fraud" if risk_score >= 0.5 else "clean",
            model="tabicl-v2",
        )
