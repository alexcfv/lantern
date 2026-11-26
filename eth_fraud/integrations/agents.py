import httpx
from pydantic import ValidationError

from eth_fraud.schemas import AnalyzeResponse, AskRequest, AskResponse


class AgentsClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def ask(self, features: AskRequest, prediction: AnalyzeResponse) -> AskResponse:
        payload = {
            **features.model_dump(mode="json"),
            "prediction": prediction.model_dump(mode="json"),
        }
        response = httpx.post(
            f"{self._base_url}/ask",
            json=payload,
            timeout=self._timeout,
        )
        response.raise_for_status()
        try:
            return AskResponse.model_validate(response.json())
        except ValidationError as exc:
            raise ValueError("invalid agents response") from exc
