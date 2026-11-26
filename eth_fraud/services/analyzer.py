from eth_fraud.ml.predictor import Predictor
from eth_fraud.schemas import AnalyzeRequest, AnalyzeResponse
from eth_fraud.services.red_flags import RedFlagChecker


class Analyzer:
    def __init__(self, checker: RedFlagChecker, predictor: Predictor) -> None:
        self._checker = checker
        self._predictor = predictor

    def analyze(self, features: AnalyzeRequest) -> AnalyzeResponse:
        if self._checker.has_red_flag(features.address):
            return AnalyzeResponse(
                address=features.address,
                verdict="scam",
                model="goplus",
                red_flag=True,
                reason="Address is flagged as malicious by GoPlus",
            )

        return self._predictor.predict(features)
