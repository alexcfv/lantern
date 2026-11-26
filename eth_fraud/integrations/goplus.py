import httpx

RED_FLAG_FIELDS = (
    "blacklist_doubt",
    "phishing_activities",
    "blackmail_activities",
    "stealing_attack",
    "financial_crime",
    "cybercrime",
    "darkweb_transactions",
    "money_laundering",
    "honeypot_related_address",
    "fake_kyc",
    "sanctioned",
    "malicious_mining_activities",
    "gas_abuse",
)


class GoPlusClient:
    def __init__(self, base_url: str, access_token: str, timeout: float, chain_id: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": access_token} if access_token else {}
        self._timeout = timeout
        self._chain_id = chain_id

    def has_red_flag(self, address: str) -> bool:
        response = httpx.get(
            f"{self._base_url}/api/v1/address_security/{address}",
            params={"chain_id": self._chain_id},
            headers=self._headers,
            timeout=self._timeout,
        )
        response.raise_for_status()

        payload = response.json()
        if payload.get("code") != 1:
            return False

        result = payload.get("result")
        if not isinstance(result, dict):
            return False

        return any(result.get(field) == "1" for field in RED_FLAG_FIELDS)
