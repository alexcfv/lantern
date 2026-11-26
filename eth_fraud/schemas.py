from datetime import date

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    address: str = Field(min_length=1)
    tx_in_count: int = Field(ge=0)
    eth_in: float = Field(ge=0)
    distinct_in_counterparties: int = Field(ge=0)
    first_in_ts: date
    last_in_ts: date
    approval_events: int = Field(ge=0)
    distinct_token_contracts: int = Field(ge=0)


class AnalyzeResponse(BaseModel):
    address: str
    fraud_probability: float | None = None
    verdict: str
    model: str


class AskRequest(AnalyzeRequest):
    user_request: str = Field(min_length=1)


class AgentResponse(BaseModel):
    agent: str
    content: str


class AskResponse(BaseModel):
    address: str
    prediction: AnalyzeResponse
    agents: list[AgentResponse]
