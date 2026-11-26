import httpx
from pydantic import ValidationError

from eth_fraud.schemas import AnalyzeRequest, AnalyzeResponse, AskResponse


class AgentsClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def ask(
        self,
        features: AnalyzeRequest,
        prediction: AnalyzeResponse,
        user_request: str,
        goplus_result: dict[str, str] | None = None,
    ) -> AskResponse:
        payload = {
            **features.model_dump(mode="json"),
            "user_request": user_request,
            "prediction": prediction.model_dump(mode="json"),
            "goplus_result": goplus_result or {},
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
