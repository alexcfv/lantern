# Ethereum Fraud Detection Pipeline — Python API and TypeScript agents service

This document describes the whole pipeline: the Python HTTP API, the TypeScript agents service, where each piece of data comes from, which component owns which decision, and how many external calls/token-heavy model calls a request can make.

The system is split into two services:

- **Python/Flask** — public HTTP API, GoPlus risk check, TabICLv2 prediction, request/response validation.
- **TypeScript/Express + Mozaik** — agent orchestration, Gemini inference, Etherscan enrichment, evidence generation, final natural-language answer.

MCP is not used in the current pipeline. Etherscan is called directly over HTTP from TypeScript, and GoPlus is called directly over HTTP from Python.

## End-to-end pipeline

```text
Client
  |
  | POST /analyze | /ask | /analyze/agents
  v
Python Flask
  |
  |-- validate JSON with Pydantic
  |-- GoPlus address_security           (1 external HTTP call)
  |-- if red flag -> prediction = scam/goplus, skip model
  |-- otherwise   -> TabICLv2 local inference
  |
  | for /ask and /analyze/agents:
  |-- AgentsClient.ask() -------------> TypeScript POST /ask
          |
          |-- Zod validation
          |-- Gateway publishes analysis.requested
          |-- Responder (Gemini) starts a runLoop
          |     |
          |     |-- optional tool call: ask_tx_analyst
          |           |
          |           |-- TxAnalyst (Gemini) starts a runLoop
          |           |     |
          |           |     |-- optional tool call: get_transaction_history
          |           |           |
          |           |           |-- Etherscan V2 txlist      (1 call)
          |           |           |-- Etherscan V2 tokentx     (1 call)
          |           |           |-- Etherscan V2 txlistinternal (1 call)
          |           |           `-- deterministic summary + evidence
          |           |
          |           `-- structured answer: summary + evidence_ids
          |
          `-- structured answer: answer
  |
  `-- Flask returns address, prediction, agents, evidence, goplus_result
```

### Who owns what

| Component | Responsibility |
| --- | --- |
| Flask | Public API, validation, GoPlus lookup, ML prediction, error mapping |
| GoPlus | Address risk labels such as `phishing_activities`, `blacklist_doubt`, `sanctioned` |
| TabICLv2 | Numeric fraud score from the nine request features; no blockchain access |
| TypeScript `/ask` | Validates agent-service request, starts the Mozaik runtime, returns 200/502 |
| Responder | Explains the verdict in English, decides whether TxAnalyst is needed, produces final answer |
| TxAnalyst | Fetches/validates wallet facts from Etherscan, returns `summary` + `evidence_ids` |
| EtherscanClient | Direct Etherscan V2 REST calls and deterministic aggregation |
| Gemini compatibility patch | Preserves Gemini 3 `thoughtSignature` across function-calling continuations |
| Evidence builders | Convert Python prediction, raw GoPlus result, and Etherscan aggregates into source-attributed facts |

## Project layout

```text
main.py                                      Flask entrypoint
eth_fraud/config.py                          Python environment settings
eth_fraud/schemas.py                         Pydantic request/response models
eth_fraud/api/app.py                         Python HTTP routes
eth_fraud/integrations/goplus.py             GoPlus client and red-flag field list
eth_fraud/integrations/agents.py             HTTP client for the TypeScript agents service
eth_fraud/services/red_flags.py              GoPlus red-flag evaluation with fail-open behavior
eth_fraud/services/analyzer.py               GoPlus + model orchestration
eth_fraud/ml/features.py                     Feature vector construction
eth_fraud/ml/predictor.py                    Predictor protocol and stub predictor
eth_fraud/ml/tabicl_predictor.py             TabICLv2 wrapper
eth_fraud/ml/wallet_risk_model/              Model artifacts

agents-ts/src/main.ts                        Express entrypoint
agents-ts/src/app.ts                         TypeScript HTTP routes
agents-ts/src/config.ts                      TypeScript environment settings
agents-ts/src/schemas.ts                     Zod schemas and shared types
agents-ts/src/agents/orchestrator.ts         Mozaik agents, tools, events, observers
agents-ts/src/agents/gemini-tool-compat.ts   Gemini function-calling compatibility patch
agents-ts/src/integrations/etherscan.ts      Etherscan V2 client, aggregation, evidence
agents-ts/.env.example                       TypeScript env template
```

Model artifacts in `eth_fraud/ml/wallet_risk_model/`:

```text
config.json                  Feature order and log-transform indices
X_context.npy                In-context features
y_context.npy                In-context target
tabicl-classifier-v2.ckpt    TabICLv2 checkpoint, stored in Git LFS
```

## Requirements

- Python 3.10+
- Git LFS for the checkpoint
- Node.js 20+ / npm
- Gemini API key with access to the configured `AGENT_MODEL`
- Etherscan API key for the enrichment tool

Python dependencies come from `pyproject.toml`: Flask, Pydantic, httpx, NumPy, TabICL.

TypeScript dependencies come from `agents-ts/package.json`: `@mozaik-ai/core`, `dotenv`, `express`, `zod`, plus TypeScript tooling.

## Install and run

### Python service

```bash
git lfs install
git lfs pull

python -m venv .venv
source .venv/bin/activate
pip install "Flask>=3.0,<4" "pydantic>=2,<3" "httpx>=0.27,<1" "numpy>=2,<3" "tabicl>=2.2,<3"

python main.py
```

Default port: `5000`.

For a lightweight run without TabICL:

```bash
MODEL_BACKEND=stub python main.py
```

In stub mode, `fraud_probability` is `null`, `verdict` is `"unknown"`, and `model` is `"stub"`. GoPlus red flags still work.

### TypeScript agents service

```bash
cd agents-ts
npm install
cp .env.example .env
# fill GEMINI_API_KEY and ETHERSCAN_API_KEY

npm run dev
# or: npm run build && npm start
```

Default port: `3000`.

The Python service expects the agents service at `AGENTS_BASE_URL`, default `http://127.0.0.1:3000`.

Health check:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok"}
```

## Configuration

### Python

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | Flask port |
| `MODEL_BACKEND` | `tabicl` | `tabicl` or `stub` |
| `MODEL_REFERENCE_DATE` | today | ISO date used for time-derived features |
| `GOPLUS_BASE_URL` | `https://api.gopluslabs.io` | GoPlus base URL |
| `GOPLUS_ACCESS_TOKEN` | empty | Optional `Authorization` header value |
| `GOPLUS_TIMEOUT_SECONDS` | `5` | GoPlus request timeout |
| `CHAIN_ID` | `1` | Chain ID passed to GoPlus |
| `AGENTS_BASE_URL` | `http://127.0.0.1:3000` | TypeScript agents service base URL |
| `AGENTS_TIMEOUT_SECONDS` | `10` | Agents-service request timeout |

`MODEL_REFERENCE_DATE` should usually match the dataset snapshot date; otherwise `in_age_days` and `days_since_last_in` are computed from the current date.

### TypeScript

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Express port |
| `AGENTS_TIMEOUT_MS` | `8000` | Total timeout for one agent analysis |
| `AGENT_MODEL` | `gemini-3.5-flash-lite` | Mozaik model name used by both agents |
| `GEMINI_API_KEY` | empty | Gemini API key |
| `ETHERSCAN_API_KEY` | empty | Etherscan V2 API key |
| `ETHERSCAN_CHAIN_ID` | `1` | Chain ID used in Etherscan V2 requests |
| `ETHERSCAN_BASE_URL` | `https://api.etherscan.io` | Etherscan base URL |
| `ETHERSCAN_TIMEOUT_MS` | `5000` | Timeout per Etherscan request |

Python's `AGENTS_TIMEOUT_SECONDS` should be larger than TypeScript's `AGENTS_TIMEOUT_MS`; otherwise Flask may stop waiting before the agents service returns its own error.

## Common request fields

All public Python endpoints accept the same eight core fields:

| Field | Type | Constraint |
| --- | --- | --- |
| `address` | string | non-empty |
| `tx_in_count` | integer | `>= 0` |
| `eth_in` | number | `>= 0` |
| `distinct_in_counterparties` | integer | `>= 0` |
| `first_in_ts` | string | `YYYY-MM-DD` |
| `last_in_ts` | string | `YYYY-MM-DD` |
| `approval_events` | integer | `>= 0` |
| `distinct_token_contracts` | integer | `>= 0` |

The TypeScript `/ask` additionally requires `user_request`, `prediction`, and `goplus_result`. The first is supplied by the public API client; the latter two are injected by Python and must not be sent by public `/ask` clients.

## `POST /analyze`

Runs the GoPlus check and, if clean, TabICLv2. Does not call the agents service and does not return raw GoPlus data.

### Request

```json
{
  "address": "0x0000000000000000000000000000000000000000",
  "tx_in_count": 214,
  "eth_in": 3.87,
  "distinct_in_counterparties": 186,
  "first_in_ts": "2025-03-02",
  "last_in_ts": "2025-09-18",
  "approval_events": 41,
  "distinct_token_contracts": 12
}
```

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `address` | string | Same address |
| `fraud_probability` | number or null | `null` for flagged/stub results |
| `verdict` | string | `clean`, `fraud`, `scam`, or `unknown` |
| `model` | string | `tabicl-v2`, `goplus`, or `stub` |
| `red_flag` | boolean | Whether GoPlus flagged the address |
| `red_flags` | string[] | Triggered GoPlus field names |
| `reason` | string or null | Human-readable reason |

### Clean example

```json
{
  "address": "0x0000000000000000000000000000000000000000",
  "fraud_probability": 0.42,
  "verdict": "clean",
  "model": "tabicl-v2",
  "red_flag": false,
  "red_flags": [],
  "reason": null
}
```

### Flagged example

```json
{
  "address": "0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9",
  "fraud_probability": null,
  "verdict": "scam",
  "model": "goplus",
  "red_flag": true,
  "red_flags": ["blacklist_doubt", "phishing_activities"],
  "reason": "GoPlus: blacklist_doubt, phishing_activities"
}
```

### curl

```bash
curl -X POST http://127.0.0.1:5000/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9","tx_in_count":214,"eth_in":3.87,"distinct_in_counterparties":186,"first_in_ts":"2025-03-02","last_in_ts":"2025-09-18","approval_events":41,"distinct_token_contracts":12}'
```

## `POST /analyze/agents`

Runs the same Python analysis as `/analyze`, then calls the agents service with a fixed internal assessment prompt. Clients do not send a question to this endpoint.

Because the prompt requires `ask_tx_analyst`, this endpoint normally uses the full Etherscan enrichment path.

### Internal prompt

```text
Provide a comprehensive fraud-risk assessment of this exact wallet. Use only the supplied ML prediction, the GoPlus security result, and Etherscan facts you retrieve for this address. Explain which signals support the verdict, which contradict it or are missing, and what the transaction history, counterparties and token approvals add. Separate confirmed facts from assumptions, cite only evidence IDs you actually used, state limitations and uncertainty, do not recompute or override the ML verdict. Always call ask_tx_analyst for this wallet before answering. Answer in English with sections: Summary, Supporting evidence, Contradicting or missing evidence, Next checks.
```

### Request

```json
{
  "address": "0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9",
  "tx_in_count": 214,
  "eth_in": 3.87,
  "distinct_in_counterparties": 186,
  "first_in_ts": "2025-03-02",
  "last_in_ts": "2025-09-18",
  "approval_events": 41,
  "distinct_token_contracts": 12
}
```

Clients do not send `user_request`, `prediction`, or `goplus_result`: Python builds the internal task and injects both computed fields.

### Response

```json
{
  "address": "0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9",
  "prediction": {
    "address": "0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9",
    "fraud_probability": null,
    "verdict": "scam",
    "model": "goplus",
    "red_flag": true,
    "red_flags": ["blacklist_doubt", "phishing_activities"],
    "reason": "GoPlus: blacklist_doubt, phishing_activities"
  },
  "agents": [
    {
      "agent": "TxAnalyst",
      "content": "Etherscan data for this wallet shows first activity on 2015-09-28 and last activity on 2023-03-07. There are 214 regular transactions, 9 internal transactions, and 41 token transactions across 186 distinct counterparties and 12 token symbols. The largest ETH transaction is 3.87 ETH, and 61.2% of received ETH was sent out. No inflow burst followed by an outflow was found."

    },
    {
      "agent": "Responder",
      "content": "Summary: GoPlus flags this wallet as scam because of blacklist_doubt and phishing_activities; the ML model was not called (model.verdict, model.red_flags).\nSupporting evidence: the two GoPlus flags are explicit (goplus.blacklist_doubt, goplus.phishing_activities), and Etherscan shows a long-lived address with 186 counterparties and 12 token symbols (etherscan.counterparties, etherscan.token_symbols).\nContradicting or missing evidence: GoPlus reports no cybercrime, money laundering, darkweb, sanction, mixer, or malicious contract creation flags (goplus.zero_checks), and no inflow burst followed by an outflow was found (etherscan.burst_gap).\nNext checks: inspect the phishing reports and the largest counterparties before treating this address as trusted."
    }
  ],
  "evidence": [
    {
      "id": "model.verdict",
      "claim": "Verdict: scam.",
      "source": "Model",
      "detail": "model: goplus"
    },
    {
      "id": "model.red_flags",
      "claim": "Red flags: blacklist_doubt, phishing_activities.",
      "source": "Model",
      "detail": "GoPlus: blacklist_doubt, phishing_activities"
    },
    {
      "id": "goplus.blacklist_doubt",
      "claim": "GoPlus blacklist_doubt: 1.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "goplus.phishing_activities",
      "claim": "GoPlus phishing_activities: 1.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "goplus.zero_checks",
      "claim": "No GoPlus flags for these checks: blackmail_activities, contract_address, cybercrime, darkweb_transactions, fake_kyc, fake_standard_interface, fake_token, financial_crime, gas_abuse, honeypot_related_address, malicious_mining_activities, mixer, money_laundering, number_of_malicious_contracts_created, reinit, sanctioned, stealing_attack.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "etherscan.activity_period",
      "claim": "First activity on 2015-09-28, last activity on 2023-03-07.",
      "source": "Etherscan data",
      "detail": "Timestamps from txlist/tokentx/txlistinternal, chain 1."
    },
    {
      "id": "etherscan.transaction_counts",
      "claim": "214 regular transactions, 9 internal transactions, and 41 token transactions.",
      "source": "Etherscan data",
      "detail": "Counted by our code from txlist/txlistinternal/tokentx."
    },
    {
      "id": "etherscan.counterparties",
      "claim": "186 distinct counterparties.",
      "source": "Etherscan data",
      "detail": "Unique from/to addresses counted by our code."
    },
    {
      "id": "etherscan.token_symbols",
      "claim": "12 distinct token symbols.",
      "source": "Etherscan data",
      "detail": "Unique tokenSymbol values counted by our code from tokentx."
    },
    {
      "id": "etherscan.largest_eth",
      "claim": "Largest ETH transaction: 3.87.",
      "source": "Etherscan data",
      "detail": "wei converted to ETH by our code from txlist/txlistinternal."
    },
    {
      "id": "etherscan.sent_received_ratio",
      "claim": "Sent 61.2% of received ETH.",
      "source": "Etherscan data",
      "detail": "Sent and received ETH counted by our code from normal and internal transactions."
    },
    {
      "id": "etherscan.burst_gap",
      "claim": "No inflow burst followed by an outflow was found.",
      "source": "Etherscan data",
      "detail": "Burst = most inflows inside a 10-minute window; gap to the next outflow counted by our code."
    }
  ],
  "goplus_result": {
    "blacklist_doubt": "1",
    "blackmail_activities": "0",
    "contract_address": "0",
    "cybercrime": "0",
    "darkweb_transactions": "0",
    "data_source": "GoPlus",
    "fake_kyc": "0",
    "fake_standard_interface": "0",
    "fake_token": "0",
    "financial_crime": "0",
    "gas_abuse": "0",
    "honeypot_related_address": "0",
    "malicious_mining_activities": "0",
    "mixer": "0",
    "money_laundering": "0",
    "number_of_malicious_contracts_created": "0",
    "phishing_activities": "1",
    "reinit": "0",
    "sanctioned": "0",
    "stealing_attack": "0"
  }
}
```

Rendered `Responder.content`:

```text
Summary: GoPlus flags this wallet as scam because of blacklist_doubt and phishing_activities; the ML model was not called (model.verdict, model.red_flags).
Supporting evidence: the two GoPlus flags are explicit (goplus.blacklist_doubt, goplus.phishing_activities), and Etherscan shows a long-lived address with 186 counterparties and 12 token symbols (etherscan.counterparties, etherscan.token_symbols).
Contradicting or missing evidence: GoPlus reports no cybercrime, money laundering, darkweb, sanction, mixer, or malicious contract creation flags (goplus.zero_checks), and no inflow burst followed by an outflow was found (etherscan.burst_gap).
Next checks: inspect the phishing reports and the largest counterparties before treating this address as trusted.
```

`prediction` is the same object as the `/analyze` response. `goplus_result` is the raw flat GoPlus map with string values. `evidence` is produced by the agents service.

### Clean-wallet example: GoPlus passes, TabICL computes risk score

GoPlus and Etherscan values below were observed for `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`. The TabICL score is illustrative.

#### Request

```json
{
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "tx_in_count": 100,
  "eth_in": 64709.4112,
  "distinct_in_counterparties": 110,
  "first_in_ts": "2015-09-28",
  "last_in_ts": "2023-03-07",
  "approval_events": 41,
  "distinct_token_contracts": 27
}
```

#### Response

```json
{
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "prediction": {
    "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "fraud_probability": 0.73,
    "verdict": "fraud",
    "model": "tabicl-v2",
    "red_flag": false,
    "red_flags": [],
    "reason": null
  },
  "agents": [
    {
      "agent": "TxAnalyst",
      "content": "Etherscan data for this wallet shows first activity on 2015-09-28 and last activity on 2023-03-07. There are 100 regular transactions, 100 internal transactions, and 100 token transactions across 110 distinct counterparties and 27 token symbols. The largest ETH transaction is 40000.0 ETH, and 0.0% of received ETH was sent out. No inflow burst followed by an outflow was found."
    },
    {
      "agent": "Responder",
      "content": "Summary: GoPlus does not flag this wallet, but TabICL assigns a fraud probability of 0.73, so the prediction is fraud (model.verdict, model.fraud_probability).\nSupporting evidence: GoPlus reports no fraud flags (goplus.zero_checks), and Etherscan shows 100 regular, 100 internal, and 100 token transactions across 110 counterparties and 27 token symbols (etherscan.transaction_counts, etherscan.counterparties, etherscan.token_symbols).\nContradicting or missing evidence: there is no blacklist_doubt or phishing_activities flag, only 0.0% of received ETH was sent out (etherscan.sent_received_ratio), and no inflow burst followed by an outflow was found (etherscan.burst_gap). The GoPlus contract_address field is 1, but it is not in the configured red-flag list (goplus.contract_address).\nNext checks: verify why the model score is high for this address and confirm the contract flag in a block explorer before acting on the score."
    }
  ],
  "evidence": [
    {
      "id": "model.verdict",
      "claim": "Verdict: fraud.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "model.fraud_probability",
      "claim": "Fraud probability: 0.73.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "model.red_flags",
      "claim": "No red flags were detected.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "goplus.contract_address",
      "claim": "GoPlus contract_address: 1.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "goplus.zero_checks",
      "claim": "No GoPlus flags for these checks: cybercrime, money_laundering, number_of_malicious_contracts_created, gas_abuse, financial_crime, darkweb_transactions, reinit, phishing_activities, fake_kyc, blacklist_doubt, fake_standard_interface, stealing_attack, blackmail_activities, sanctioned, malicious_mining_activities, mixer, fake_token, honeypot_related_address.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "etherscan.activity_period",
      "claim": "First activity on 2015-09-28, last activity on 2023-03-07.",
      "source": "Etherscan data",
      "detail": "Timestamps from txlist/tokentx/txlistinternal, chain 1."
    },
    {
      "id": "etherscan.transaction_counts",
      "claim": "100 regular transactions, 100 internal transactions, and 100 token transactions.",
      "source": "Etherscan data",
      "detail": "Counted by our code from txlist/txlistinternal/tokentx."
    },
    {
      "id": "etherscan.counterparties",
      "claim": "110 distinct counterparties.",
      "source": "Etherscan data",
      "detail": "Unique from/to addresses counted by our code."
    },
    {
      "id": "etherscan.token_symbols",
      "claim": "27 distinct token symbols.",
      "source": "Etherscan data",
      "detail": "Unique tokenSymbol values counted by our code from tokentx."
    },
    {
      "id": "etherscan.largest_eth",
      "claim": "Largest ETH transaction: 40000.0.",
      "source": "Etherscan data",
      "detail": "wei converted to ETH by our code from txlist/txlistinternal."
    },
    {
      "id": "etherscan.sent_received_ratio",
      "claim": "Sent 0.0% of received ETH.",
      "source": "Etherscan data",
      "detail": "Sent and received ETH counted by our code from normal and internal transactions."
    },
    {
      "id": "etherscan.burst_gap",
      "claim": "No inflow burst followed by an outflow was found.",
      "source": "Etherscan data",
      "detail": "Burst = most inflows inside a 10-minute window; gap to the next outflow counted by our code."
    }
  ],
  "goplus_result": {
    "blacklist_doubt": "0",
    "blackmail_activities": "0",
    "contract_address": "1",
    "cybercrime": "0",
    "darkweb_transactions": "0",
    "data_source": "",
    "fake_kyc": "0",
    "fake_standard_interface": "0",
    "fake_token": "0",
    "financial_crime": "0",
    "gas_abuse": "0",
    "honeypot_related_address": "0",
    "malicious_mining_activities": "0",
    "mixer": "0",
    "money_laundering": "0",
    "number_of_malicious_contracts_created": "0",
    "phishing_activities": "0",
    "reinit": "0",
    "sanctioned": "0",
    "stealing_attack": "0"
  }
}
```

Rendered `Responder.content`:

```text
Summary: GoPlus does not flag this wallet, but TabICL assigns a fraud probability of 0.73, so the prediction is fraud (model.verdict, model.fraud_probability).
Supporting evidence: GoPlus reports no fraud flags (goplus.zero_checks), and Etherscan shows 100 regular, 100 internal, and 100 token transactions across 110 counterparties and 27 token symbols (etherscan.transaction_counts, etherscan.counterparties, etherscan.token_symbols).
Contradicting or missing evidence: there is no blacklist_doubt or phishing_activities flag, only 0.0% of received ETH was sent out (etherscan.sent_received_ratio), and no inflow burst followed by an outflow was found (etherscan.burst_gap). The GoPlus contract_address field is 1, but it is not in the configured red-flag list (goplus.contract_address).
Next checks: verify why the model score is high for this address and confirm the contract flag in a block explorer before acting on the score.
```

In this example `red_flag` is `false`, `fraud_probability` is populated by TabICL, and `model` is `tabicl-v2`. In the previous example GoPlus short-circuited the pipeline and `fraud_probability` stayed `null`.

### curl

```bash
curl -X POST http://127.0.0.1:5000/analyze/agents \
  -H "Content-Type: application/json" \
  -d '{"address":"0x6D8c070338eC3d297f1D0ECEEA296bd7E13a32b9","tx_in_count":214,"eth_in":3.87,"distinct_in_counterparties":186,"first_in_ts":"2025-03-02","last_in_ts":"2025-09-18","approval_events":41,"distinct_token_contracts":12}'
```

## `POST /ask`

Same as `/analyze/agents`, but the client supplies the question. This is the only public endpoint where the user controls the agent task.

### Request

```json
{
  "address": "0x0000000000000000000000000000000000000000",
  "tx_in_count": 214,
  "eth_in": 3.87,
  "distinct_in_counterparties": 186,
  "first_in_ts": "2025-03-02",
  "last_in_ts": "2025-09-18",
  "approval_events": 41,
  "distinct_token_contracts": 12,
  "user_request": "When were the first and last transactions for this wallet?"
}
```

`user_request` must be a non-empty string. The client must not send `prediction` or `goplus_result`: Python computes/injects both.

### Response

Same shape as `/analyze/agents`.

### Full response example

The values below are illustrative. The structure is the exact JSON returned to a Python API client.

```json
{
  "address": "0x0000000000000000000000000000000000000000",
  "prediction": {
    "address": "0x0000000000000000000000000000000000000000",
    "fraud_probability": 0.42,
    "verdict": "clean",
    "model": "tabicl-v2",
    "red_flag": false,
    "red_flags": [],
    "reason": null
  },
  "agents": [
    {
      "agent": "TxAnalyst",
      "content": "No dated Etherscan activity was found for this wallet."
    },
    {
      "agent": "Responder",
      "content": "Summary: The ML model classifies this wallet as clean with a fraud probability of 0.42 (model.verdict, model.fraud_probability).\nSupporting evidence: GoPlus reports no flags for the supplied checks (goplus.zero_checks), and no dated Etherscan activity was found (etherscan.activity_period).\nContradicting or missing evidence: there is no transaction history to confirm counterparties or token activity, so the answer is limited to the supplied features and GoPlus result.\nNext checks: verify the address with a block explorer or provide an address with transaction history."
    }
  ],
  "evidence": [
    {
      "id": "model.verdict",
      "claim": "Verdict: clean.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "model.fraud_probability",
      "claim": "Fraud probability: 0.42.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "model.red_flags",
      "claim": "No red flags were detected.",
      "source": "Model",
      "detail": "model: tabicl-v2"
    },
    {
      "id": "goplus.zero_checks",
      "claim": "No GoPlus flags for these checks: cybercrime, money_laundering, number_of_malicious_contracts_created, gas_abuse, financial_crime, darkweb_transactions, reinit, contract_address, fake_kyc, fake_standard_interface, stealing_attack, blackmail_activities, sanctioned, malicious_mining_activities, mixer, fake_token, honeypot_related_address.",
      "source": "GoPlus",
      "detail": "Raw address security result from GoPlus."
    },
    {
      "id": "etherscan.activity_period",
      "claim": "No dated Etherscan activity was found.",
      "source": "Etherscan data",
      "detail": "Timestamps from txlist/tokentx/txlistinternal, chain 1."
    },
    {
      "id": "etherscan.transaction_counts",
      "claim": "0 regular transactions, 0 internal transactions, and 0 token transactions.",
      "source": "Etherscan data",
      "detail": "Counted by our code from txlist/txlistinternal/tokentx."
    },
    {
      "id": "etherscan.counterparties",
      "claim": "0 distinct counterparties.",
      "source": "Etherscan data",
      "detail": "Unique from/to addresses counted by our code."
    },
    {
      "id": "etherscan.token_symbols",
      "claim": "0 distinct token symbols.",
      "source": "Etherscan data",
      "detail": "Unique tokenSymbol values counted by our code from tokentx."
    },
    {
      "id": "etherscan.largest_eth",
      "claim": "Largest ETH transaction: 0.",
      "source": "Etherscan data",
      "detail": "wei converted to ETH by our code from txlist/txlistinternal."
    },
    {
      "id": "etherscan.sent_received_ratio",
      "claim": "Received ETH is zero, so the sent/received ratio is unavailable.",
      "source": "Etherscan data",
      "detail": "Sent and received ETH counted by our code from normal and internal transactions."
    },
    {
      "id": "etherscan.burst_gap",
      "claim": "No inflow burst followed by an outflow was found.",
      "source": "Etherscan data",
      "detail": "Burst = most inflows inside a 10-minute window; gap to the next outflow counted by our code."
    }
  ],
  "goplus_result": {
    "blacklist_doubt": "0",
    "blackmail_activities": "0",
    "contract_address": "0",
    "cybercrime": "0",
    "darkweb_transactions": "0",
    "data_source": "GoPlus",
    "fake_kyc": "0",
    "fake_standard_interface": "0",
    "fake_token": "0",
    "financial_crime": "0",
    "gas_abuse": "0",
    "honeypot_related_address": "0",
    "malicious_mining_activities": "0",
    "mixer": "0",
    "money_laundering": "0",
    "number_of_malicious_contracts_created": "0",
    "phishing_activities": "0",
    "reinit": "0",
    "sanctioned": "0",
    "stealing_attack": "0"
  }
}
```

Rendered `Responder.content`:

```text
Summary: The ML model classifies this wallet as clean with a fraud probability of 0.42 (model.verdict, model.fraud_probability).
Supporting evidence: GoPlus reports no flags for the supplied checks (goplus.zero_checks), and no dated Etherscan activity was found (etherscan.activity_period).
Contradicting or missing evidence: there is no transaction history to confirm counterparties or token activity, so the answer is limited to the supplied features and GoPlus result.
Next checks: verify the address with a block explorer or provide an address with transaction history.
```

### curl

```bash
curl -X POST http://127.0.0.1:5000/ask \
  -H "Content-Type: application/json" \
  -d '{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","tx_in_count":12,"eth_in":3.5,"distinct_in_counterparties":9,"first_in_ts":"2025-01-01","last_in_ts":"2025-06-01","approval_events":2,"distinct_token_contracts":3,"user_request":"Show the transaction history for this wallet."}'
```

## TypeScript service contract

The Python service calls this endpoint internally. Direct callers must provide the computed prediction and raw GoPlus result.

### `POST http://127.0.0.1:3000/ask`

```json
{
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "tx_in_count": 12,
  "eth_in": 3.5,
  "distinct_in_counterparties": 9,
  "first_in_ts": "2025-01-01",
  "last_in_ts": "2025-06-01",
  "approval_events": 2,
  "distinct_token_contracts": 3,
  "user_request": "Show the transaction history for this wallet.",
  "prediction": {
    "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "fraud_probability": 0.42,
    "verdict": "clean",
    "model": "tabicl-v2",
    "red_flag": false,
    "red_flags": [],
    "reason": null
  },
  "goplus_result": {
    "phishing_activities": "0",
    "blacklist_doubt": "0",
    "contract_address": "0"
  }
}
```

Validation is strict. Dates are checked as real calendar dates, not only by regex. Invalid requests return:

```json
{
  "error": "invalid request",
  "details": [{"field": "first_in_ts", "message": "expected a valid date in YYYY-MM-DD format"}]
}
```

Agent failures return `502`:

```json
{"error": "agents unavailable", "details": "..."}
```

## Agent orchestration

The runtime uses Mozaik humans/agents and semantic events. For every analysis, a new `requestId` is generated and all relevant events are filtered by that ID.

### Participants

| Participant | Type | Role |
| --- | --- | --- |
| `Gateway` | human | Publishes `analysis.requested` |
| `Responder` | agent | Gemini-based final answer agent; owns `ask_tx_analyst` |
| `TxAnalyst` | agent | Gemini-based factual agent; owns `get_transaction_history` |
| `AnalystObserver` | human | Converts TxAnalyst `model.answer` into `enrichment.completed` |
| `ResponderObserver` | human | Converts Responder `model.answer` into `analysis.completed` |
| `Observer` | human | Resolves/rejects the top-level promise |

### Event flow

1. `Gateway` publishes `analysis.requested`.
2. `Responder` starts a Gemini `runLoop` with:
   - the user question,
   - the wallet address,
   - the ML prediction,
   - the raw GoPlus result,
   - static evidence,
   - the `ask_tx_analyst` tool,
   - a strict `responder_answer` structured-output schema.
3. If the question needs on-chain facts, Responder calls `ask_tx_analyst`.
4. `ask_tx_analyst` publishes `enrichment.requested` and waits for `enrichment.completed`.
5. `TxAnalyst` starts a Gemini `runLoop` with the same wallet context and strict `tx_analyst_answer` structured output: `summary` + `evidence_ids`.
6. TxAnalyst calls `get_transaction_history` only for the address from the request. Any other address raises `Only the requested wallet can be inspected`.
7. EtherscanClient performs three parallel requests and returns a deterministic summary plus evidence.
8. `AnalystObserver` validates the returned `evidence_ids`; unknown IDs are discarded.
9. `ask_tx_analyst` returns `summary`, `evidence`, and `evidence_ids` to Responder.
10. Responder produces the final structured answer.
11. `ResponderObserver` builds `AskResponse` with `agents`, full `evidence`, `prediction`, and `goplus_result`.

### Scope guardrails

The agents are deliberately restricted:

- Only the provided wallet can be inspected.
- GoPlus data is read from `prediction` / `goplus_result`; agents do not call GoPlus.
- Etherscan calls are allowed only through `get_transaction_history(address)` with the request address.
- Questions about other wallets, “latest scam wallets”, or global lists are answered with a refusal.
- Agents must not recompute or override the ML/GoPlus verdict.
- Everything must be in English.

### Structured output

| Agent | Schema | Notes |
| --- | --- | --- |
| TxAnalyst | `{ summary: string, evidence_ids: string[] }` | `evidence_ids` are filtered against IDs actually produced by code |
| Responder | `{ answer: string }` | Final user-facing answer |

`evidence_ids` are internal to agent communication; they are not a separate top-level API field. The full top-level `evidence` array is returned to the client.

### Gemini function-calling compatibility

`gemini-tool-compat.ts` patches the Mozaik Gemini endpoint mapper:

- Gemini 3 requires `thoughtSignature` on function-call continuations; the patch preserves it between `functionCall` response parts and follow-up requests.
- It strips the `default_api:` prefix from tool names so tool names match the registered tools.

Without this patch, Gemini rejects the second inference after a tool call with `Function call is missing a thought_signature`.

## Data sources and evidence

### Source responsibilities

| Source | What it provides | Typical questions |
| --- | --- | --- |
| GoPlus | Address risk labels: phishing, malicious, blacklist, etc. | “Why is the address flagged?”, “What red flags are present?”, “Are there suspicious labels?” |
| Etherscan | On-chain facts: history, dates, counterparties, tokens, ETH flows, burst gap | “What is the transaction history?”, “Who are the counterparties?”, “How much ETH was sent/received?”, “When did the transactions happen?” |
| ML model | Numeric fraud probability from request features | “What did the model decide?”, “What is the fraud probability?” |
| Our code | Aggregations over GoPlus/Etherscan results | “How many counterparties?”, “What percent of received ETH was sent out?” |

### Evidence IDs

| ID | Source | Meaning |
| --- | --- | --- |
| `model.verdict` | `Model` | Verdict from `prediction.verdict` |
| `model.fraud_probability` | `Model` | Probability from `prediction.fraud_probability`, if present |
| `model.red_flags` | `Model` | Flags from `prediction.red_flags`, or “No red flags were detected” |
| `goplus.<field>` | `GoPlus` | Raw GoPlus field with value `"1"` |
| `goplus.zero_checks` | `GoPlus` | Raw GoPlus fields with value `"0"` |
| `etherscan.activity_period` | `Etherscan data` | First/last activity date from `txlist`, `tokentx`, `txlistinternal` |
| `etherscan.transaction_counts` | `Etherscan data` | Counts of regular, internal, and token transactions |
| `etherscan.counterparties` | `Etherscan data` | Number of unique `from`/`to` addresses counted by our code |
| `etherscan.token_symbols` | `Etherscan data` | Number of unique `tokenSymbol` values from `tokentx` |
| `etherscan.largest_eth` | `Etherscan data` | Largest ETH value, wei converted to ETH |
| `etherscan.sent_received_ratio` | `Etherscan data` | `sentEth / receivedEth`, shown as `sentPercent = ratio * 100`; normal + internal transactions |
| `etherscan.burst_gap` | `Etherscan data` | Gap to first outflow after the 10-minute window with the most inflows |

Important details:

- `limit` is `100` records per Etherscan action.
- `tokentx` values are token amounts; they are not included in ETH sums.
- `txlistinternal` is included in ETH sums and counterparties.
- If no Etherscan tool call happens, `etherscan.*` evidence is absent.
- If `goplus_result` is empty, GoPlus evidence is absent.
- Evidence is generated by code, not by the LLM.

### Burst-gap algorithm

The burst-gap metric is deterministic:

1. Collect positive-value inflows: transactions where `to == address`.
2. Collect positive-value outflows: transactions where `from == address`.
3. Sort both lists by timestamp.
4. Find the 10-minute window containing the largest number of inflows.
5. Take the last inflow timestamp in that window.
6. Find the first outflow after it.
7. Report the gap in minutes, rounded to two decimals.

If there are fewer than two inflows or no later outflow, the metric is `null` and the evidence says no burst was found.

## Call and token budget

### Exact external calls per request

| Path | GoPlus HTTP | Python → TypeScript | TypeScript → Gemini | TypeScript → Etherscan |
| --- | --- | --- | --- | --- |
| `/analyze` | 1 | 0 | 0 | 0 |
| `/ask`, no tool needed | 1 | 1 | 1 | 0 |
| `/ask`, full Etherscan path | 1 | 1 | 4 | 3 parallel |
| `/analyze/agents` | 1 | 1 | 4 normally | 3 parallel normally |

Gemini call breakdown for the full path:

1. Responder decides that TxAnalyst is needed.
2. TxAnalyst decides that `get_transaction_history` is needed.
3. TxAnalyst produces `summary` + `evidence_ids` after the Etherscan tool result.
4. Responder produces the final `answer` after `ask_tx_analyst` returns.

If Responder does not call `ask_tx_analyst`, only one Gemini call happens. If TxAnalyst is called but does not call Etherscan, three Gemini calls happen and zero Etherscan calls.

### Token accounting

The current code does **not** log or expose exact token usage. Mozaik emits token usage in `inference.completed`, but the orchestrator only consumes `model.answer`; it does not record `tokenUsage`. Therefore exact billed input/output token counts cannot be read from the API response or logs today.

Rough estimates for capacity planning:

| Path | Input tokens | Output tokens | Notes |
| --- | --- | --- | --- |
| `/ask`, no tool | ~2k–5k | ~0.2k–0.6k | Prediction + GoPlus result + static evidence |
| `/ask`, full Etherscan path | ~8k–20k | ~1k–2k | Includes Responder initial, TxAnalyst initial, Etherscan tool result, two final answers |

The main variable is the size of `goplus_result` and the Etherscan tool result. `get_transaction_history` returns full unique counterparty lists and token symbols; with `limit=100` per action this can be several thousand tokens by itself.

To get exact accounting, add an observer for `inference.completed` and log `tokenUsage.inputTokens`, `tokenUsage.outputTokens`, `tokenUsage.inputTokenDetails.cached_tokens`, and `tokenUsage.outputTokenDetails.reasoning_tokens` per `requestId`.

### Timeouts

- Python GoPlus timeout: `GOPLUS_TIMEOUT_SECONDS`, default 5s.
- Python → TypeScript timeout: `AGENTS_TIMEOUT_SECONDS`, default 10s.
- TypeScript total analysis timeout: `AGENTS_TIMEOUT_MS`, default 8s.
- Etherscan per-request timeout: `ETHERSCAN_TIMEOUT_MS`, default 5s.
- `ask_tx_analyst` wait timeout: `AGENTS_TIMEOUT_MS - 1000`, minimum 1000ms.

Recommended production setup: `AGENTS_TIMEOUT_SECONDS > AGENTS_TIMEOUT_MS > ETHERSCAN_TIMEOUT_MS`.

## Errors

### Python

Invalid JSON object:

```json
{"error": "expected a JSON object"}
```

Validation failure:

```json
{
  "error": "invalid request",
  "details": [
    {
      "type": "greater_than_equal",
      "loc": ["tx_in_count"],
      "msg": "Input should be greater than or equal to 0"
    }
  ]
}
```

Agents service unavailable, returned by `/ask` and `/analyze/agents`:

```json
{"error": "agents unavailable", "details": "..."}
```

Status codes: `400` for bad input, `502` for agents-service failures.

GoPlus failures fail open: the address is treated as not flagged and the pipeline continues to the model.

### TypeScript

Invalid request: `400` with `{ "error": "invalid request", "details": [...] }`.

Internal agent failure or timeout: `502` with `{ "error": "agents unavailable", "details": "..." }`.

Health check: `GET /health` returns `{"status":"ok"}`.

## Response value reference

This section lists the values a third-party client can receive from the Python API. Any value not listed here is outside the current contract and should be treated as undefined.

### `AnalyzeResponse`

Returned directly by `/analyze` and nested as `prediction` in `/ask` and `/analyze/agents`.

| Field | Possible values | Meaning |
| --- | --- | --- |
| `address` | non-empty string | Echo of the requested address |
| `fraud_probability` | `null` | GoPlus red flag, or stub backend |
| | float in `[0, 1]` | TabICLv2 class-1 probability |
| `verdict` | `clean` | No GoPlus flag and TabICL score `< 0.5` |
| | `fraud` | No GoPlus flag and TabICL score `>= 0.5` |
| | `scam` | GoPlus red flag; model was not called |
| | `unknown` | Stub backend; no GoPlus flag |
| `model` | `tabicl-v2` | TabICLv2 produced the score |
| | `goplus` | GoPlus produced the verdict |
| | `stub` | Fallback backend was used |
| `red_flag` | `true` / `false` | Whether GoPlus returned at least one configured flag |
| `red_flags` | `[]` | Empty when `red_flag` is `false` |
| | subset of the red-flag list below | Non-empty when `red_flag` is `true` |
| `reason` | `null` | No GoPlus shortcut reason |
| | `"GoPlus: <flags>"` | Comma-separated flag names for a `scam` verdict |

Allowed `red_flags` values:

```text
blacklist_doubt, phishing_activities, blackmail_activities, stealing_attack,
financial_crime, cybercrime, darkweb_transactions, money_laundering,
honeypot_related_address, fake_kyc, sanctioned, malicious_mining_activities,
gas_abuse
```

### Agent response envelope

Returned by `/ask` and `/analyze/agents`.

| Field | Possible values | Meaning |
| --- | --- | --- |
| `address` | non-empty string | Echo of the requested address |
| `prediction` | `AnalyzeResponse` object | Same object as `/analyze` |
| `agents` | array of `{agent, content}` | Agent outputs in execution order |
| `goplus_result` | flat object of string values | Raw GoPlus result; `{}` if GoPlus returned nothing or failed |

Current `agents[].agent` values:

| Value | Source |
| --- | --- |
| `TxAnalyst` | Etherscan-backed transaction facts |
| `Responder` | Final written assessment |

`agents[].content` is free-form English text. It may be `"No additional facts were requested."` for `TxAnalyst` if no wallet history was fetched. Consumers should not parse this field programmatically.

### `evidence`

`evidence` is an array of objects with exactly these fields:

```json
{"id": "string", "claim": "string", "source": "string", "detail": "string"}
```

Use `id` and `source` for programmatic handling. `claim` and `detail` are human-readable text and are not stable machine values.

| `source` | Possible `id` values | When present |
| --- | --- | --- |
| `Model` | `model.verdict` | Always |
| | `model.fraud_probability` | Only when `fraud_probability` is not `null` |
| | `model.red_flags` | Always |
| `GoPlus` | `goplus.<field>` for each field with value `"1"` | For each triggered GoPlus field |
| | `goplus.zero_checks` | When at least one GoPlus field has value `"0"` |
| `Etherscan data` | `etherscan.activity_period` | When TxAnalyst fetched history |
| | `etherscan.transaction_counts` | When TxAnalyst fetched history |
| | `etherscan.counterparties` | When TxAnalyst fetched history |
| | `etherscan.token_symbols` | When TxAnalyst fetched history |
| | `etherscan.largest_eth` | When TxAnalyst fetched history |
| | `etherscan.sent_received_ratio` | When TxAnalyst fetched history |
| | `etherscan.burst_gap` | When TxAnalyst fetched history |

### `goplus_result`

`goplus_result` is passed through without conversion. Values remain strings, including boolean-like flags.

| Value shape | Meaning |
| --- | --- |
| `"1"` | Flag/check is true |
| `"0"` | Flag/check is false |
| `"GoPlus"` | Metadata value of `data_source`; not a fraud signal |
| `{}` | GoPlus unavailable, invalid response, or no result |

Known keys:

```text
blacklist_doubt, blackmail_activities, contract_address, cybercrime,
darkweb_transactions, data_source, fake_kyc, fake_standard_interface,
fake_token, financial_crime, gas_abuse, honeypot_related_address,
malicious_mining_activities, mixer, money_laundering,
number_of_malicious_contracts_created, phishing_activities, reinit,
sanctioned, stealing_attack
```

Clients should tolerate additional keys because the raw map is forwarded as-is.

## Feature engineering

Features are built in `config.json` order. Count fields are transformed with `log1p`; derived day fields are clipped to `[-1, 512]`.

| Index | Feature | Source |
| --- | --- | --- |
| 0 | `tx_in_count` | `log1p(tx_in_count)` |
| 1 | `eth_in` | `log1p(eth_in)` |
| 2 | `distinct_in_counterparties` | `log1p(distinct_in_counterparties)` |
| 3 | `approval_events` | `log1p(approval_events)` |
| 4 | `distinct_token_contracts` | `log1p(distinct_token_contracts)` |
| 5 | `has_incoming` | `1` if `tx_in_count > 0`, else `0` |
| 6 | `in_age_days` | `reference_date - first_in_ts`, in days |
| 7 | `days_since_last_in` | `reference_date - last_in_ts`, in days |
| 8 | `in_span_days` | `last_in_ts - first_in_ts`, in days |

## GoPlus red flags

GoPlus is called as:

```text
GET {GOPLUS_BASE_URL}/api/v1/address_security/{address}?chain_id={CHAIN_ID}
```

Only these fields with value `"1"` trigger a red flag:

```text
blacklist_doubt, phishing_activities, blackmail_activities, stealing_attack,
financial_crime, cybercrime, darkweb_transactions, money_laundering,
honeypot_related_address, fake_kyc, sanctioned, malicious_mining_activities,
gas_abuse
```

Other returned fields, for example `mixer`, `contract_address`, `reinit`, `fake_token`, and `data_source`, are kept in `goplus_result` but do not trigger the shortcut.

If GoPlus is unavailable or returns an invalid response, the checker fails open: the address is treated as not flagged and the pipeline continues to the model.

## Security notes

- `GEMINI_API_KEY` and `ETHERSCAN_API_KEY` are secrets and must stay in `agents-ts/.env`, which is not tracked.
- `MOZAIK_API_KEY` is not configured, so Mozaik cloud telemetry is disabled.
- Flask JSON output uses `ensure_ascii = False`, so Cyrillic and other non-ASCII text are not escaped.
- Agents cannot inspect arbitrary addresses through tools; `get_transaction_history` validates the address against the request.
