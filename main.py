from eth_fraud.api.app import create_app
from eth_fraud.config import load_settings
from eth_fraud.services.analyzer import build_analyzer

settings = load_settings()
app = create_app(build_analyzer(settings))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=settings.port)
