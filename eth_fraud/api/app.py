import logging

import httpx
from flask import Flask, jsonify, request
from pydantic import ValidationError

from eth_fraud.integrations.agents import AgentsClient
from eth_fraud.schemas import AnalyzeRequest, AskRequest, AskResponse
from eth_fraud.services.analyzer import Analyzer

logger = logging.getLogger(__name__)

INTERNAL_AGENT_QUESTION = (
    "Provide a concise fraud-risk summary of this exact wallet. "
    "Use only the supplied ML prediction, the GoPlus security result, and "
    "Etherscan facts you retrieve for this address. Treat the ML prediction "
    "as authoritative: do not question, verify, recompute, or override it. "
    "If the wallet has little observed activity, explain that the score "
    "reflects limited activity. Cite only evidence IDs you actually used. "
    "Always call ask_tx_analyst for this wallet before answering. "
    "Answer in English with a single Summary section and no next steps."
)


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

        result = analyzer.analyze(features)
        return jsonify(result.prediction.model_dump()), 200

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

        analysis = analyzer.analyze(features)
        try:
            result = agents_client.ask(
                features,
                analysis.prediction,
                features.user_request,
                analysis.goplus_result,
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("agents request failed for %s: %s", features.address, exc)
            return jsonify({"error": "agents unavailable", "details": str(exc)}), 502

        result.goplus_result = analysis.goplus_result
        return jsonify(result.model_dump(mode="json")), 200

    @app.post("/analyze/agents")
    def analyze_agents() -> tuple:
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

        analysis = analyzer.analyze(features)
        try:
            result = agents_client.ask(
                features,
                analysis.prediction,
                INTERNAL_AGENT_QUESTION,
                analysis.goplus_result,
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("agents request failed for %s: %s", features.address, exc)
            return jsonify({"error": "agents unavailable", "details": str(exc)}), 502

        result.goplus_result = analysis.goplus_result
        return jsonify(result.model_dump(mode="json")), 200

    return app
