from typing import Protocol

from eth_fraud.schemas import AnalyzeRequest, AnalyzeResponse


class Predictor(Protocol):
    def predict(self, features: AnalyzeRequest) -> AnalyzeResponse: ...


class StubPredictor:
    def predict(self, features: AnalyzeRequest) -> AnalyzeResponse:
        return AnalyzeResponse(
            address=features.address,
            fraud_probability=None,
            verdict="unknown",
            model="stub",
        )
