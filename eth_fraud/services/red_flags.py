import logging
from typing import Protocol

import httpx

from eth_fraud.integrations.goplus import GoPlusClient

logger = logging.getLogger(__name__)


class RedFlagChecker(Protocol):
    def has_red_flag(self, address: str) -> bool: ...


class GoPlusRedFlagChecker:
    def __init__(self, client: GoPlusClient) -> None:
        self._client = client

    def has_red_flag(self, address: str) -> bool:
        try:
            return self._client.has_red_flag(address)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("GoPlus check failed for %s: %s", address, exc)
            return False
