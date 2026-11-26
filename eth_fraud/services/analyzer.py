from eth_fraud.config import Settings
from eth_fraud.integrations.goplus import GoPlusClient
from eth_fraud.ml.predictor import Predictor, StubPredictor
from eth_fraud.schemas import AnalyzeRequest, AnalyzeResponse
from eth_fraud.services.red_flags import GoPlusRedFlagChecker, RedFlagChecker


class Analyzer:
    def __init__(self, checker: RedFlagChecker, predictor: Predictor) -> None:
        self._checker = checker
        self._predictor = predictor

    def analyze(self, features: AnalyzeRequest) -> AnalyzeResponse:
        red_flag = self._checker.check(features.address)
        if red_flag.flagged:
            return AnalyzeResponse(
                address=features.address,
                verdict="scam",
                model="goplus",
                red_flag=True,
                red_flags=red_flag.flags,
                reason=f"GoPlus: {', '.join(red_flag.flags)}",
            )

        return self._predictor.predict(features)


def build_analyzer(settings: Settings) -> Analyzer:
    client = GoPlusClient(
        base_url=settings.goplus_base_url,
        access_token=settings.goplus_access_token,
        timeout=settings.goplus_timeout_seconds,
        chain_id=settings.chain_id,
    )
    return Analyzer(GoPlusRedFlagChecker(client), StubPredictor())
