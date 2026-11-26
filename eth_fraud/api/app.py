import logging

import httpx
from flask import Flask, jsonify, request
from pydantic import ValidationError

from eth_fraud.integrations.agents import AgentsClient
from eth_fraud.schemas import (
    AgentResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    AskRequest,
    AskResponse,
    EvidenceItem,
)
from eth_fraud.services.analyzer import Analyzer

logger = logging.getLogger(__name__)


def build_model_evidence(prediction: AnalyzeResponse) -> list[EvidenceItem]:
    detail = f"model: {prediction.model}"
    items = [
        EvidenceItem(
            id="model.verdict",
            claim=f"Verdict: {prediction.verdict}.",
            source="Model",
            detail=detail,
        )
    ]
    if prediction.fraud_probability is not None:
        items.append(
            EvidenceItem(
                id="model.fraud_probability",
                claim=f"Fraud probability: {prediction.fraud_probability}.",
                source="Model",
                detail=detail,
            )
        )
    items.append(
        EvidenceItem(
            id="model.red_flags",
            claim=(
                f"Red flags: {', '.join(prediction.red_flags)}."
                if prediction.red_flags
                else "No red flags were detected."
            ),
            source="Model",
            detail=prediction.reason or detail,
        )
    )
    return items


def create_app(analyzer: Analyzer, agents_client: AgentsClient) -> Flask:
    app = Flask(__name__)
    app.json.ensure_ascii = False

    @app.post("/analyze")
    def analyze() -> tuple:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "expected a JSON object"}), 400

        try:
            features = AnalyzeRequest.model_validate(payload)
        except ValidationError as exc:
            return jsonify({
                "error": "invalid request",
                "details": exc.errors(include_input=False, include_context=False, include_url=False),
            }), 400

        return jsonify(analyzer.analyze(features).model_dump()), 200

    @app.post("/ask")
    def ask() -> tuple:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "expected a JSON object"}), 400

        try:
            features = AskRequest.model_validate(payload)
        except ValidationError as exc:
            return jsonify({
                "error": "invalid request",
                "details": exc.errors(include_input=False, include_context=False, include_url=False),
            }), 400

        prediction = analyzer.analyze(features)
        try:
            result = agents_client.ask(features, prediction)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("agents request failed for %s: %s", features.address, exc)
            result = AskResponse(
                address=features.address,
                prediction=prediction,
                agents=[AgentResponse(agent="system", content="Агентный анализ недоступен")],
                evidence=build_model_evidence(prediction),
            )

        return jsonify(result.model_dump(mode="json")), 200

    return app
