from flask import Flask, jsonify, request

app = Flask(__name__)

REQUIRED_FIELDS = {
    "address": str,
    "tx_in_count": int,
    "eth_in": (int, float),
    "distinct_in_counterparties": int,
    "first_in_ts": str,
    "last_in_ts": str,
    "approval_events": int,
    "distinct_token_contracts": int,
}


def predict(features: dict) -> dict:
    return {
        "address": features["address"],
        "fraud_probability": None,
        "verdict": "unknown",
        "model": "stub",
    }


@app.post("/analyze")
def analyze() -> tuple:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "expected a JSON object"}), 400

    missing = [field for field in REQUIRED_FIELDS if field not in payload]
    if missing:
        return jsonify({"error": "missing fields", "fields": missing}), 400

    invalid = [
        field
        for field, expected_type in REQUIRED_FIELDS.items()
        if isinstance(payload[field], bool) or not isinstance(payload[field], expected_type)
    ]
    if invalid:
        return jsonify({"error": "invalid field types", "fields": invalid}), 400

    return jsonify(predict(payload)), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
