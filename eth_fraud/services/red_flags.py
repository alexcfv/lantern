import logging
from typing import Protocol

import httpx

from eth_fraud.integrations.goplus import RED_FLAG_FIELDS, GoPlusClient
from eth_fraud.schemas import RedFlagResult

logger = logging.getLogger(__name__)


class RedFlagChecker(Protocol):
    def check(self, address: str) -> RedFlagResult: ...


class GoPlusRedFlagChecker:
    def __init__(self, client: GoPlusClient) -> None:
        self._client = client

    def check(self, address: str) -> RedFlagResult:
        try:
            result = self._client.check(address)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("GoPlus check failed for %s: %s", address, exc)
            return RedFlagResult(flagged=False)

        flags = [field for field in RED_FLAG_FIELDS if result.get(field) == "1"]
        return RedFlagResult(flagged=bool(flags), flags=flags, result=result)

    def has_red_flag(self, address: str) -> bool:
        return self.check(address).flagged
