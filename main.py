from eth_fraud.api.app import create_app
from eth_fraud.config import load_settings

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=load_settings().port)
