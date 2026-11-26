from flask import Flask, jsonify, request
from pydantic import ValidationError

from eth_fraud.ml.predictor import Predictor, StubPredictor
from eth_fraud.schemas import AnalyzeRequest


def create_app(predictor: Predictor | None = None) -> Flask:
    app = Flask(__name__)
    predictor = predictor or StubPredictor()

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

        return jsonify(predictor.predict(features).model_dump()), 200

    return app
