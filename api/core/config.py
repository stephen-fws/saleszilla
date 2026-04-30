import json
import os

from dotenv import load_dotenv

load_dotenv()

# ── Application ──────────────────────────────────────────────────────────────
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# ── SQL Server ───────────────────────────────────────────────────────────────
# Configured via a single MSSQL_CONFIG env var holding JSON, e.g.:
# MSSQL_CONFIG='{"server":"FWS-LP-1499\\\\SQLSERVER2022","database":"CRMSalesPotentialls","username":"sa","password":"...","driver":"ODBC Driver 17 for SQL Server"}'
def _load_mssql_config() -> dict:
    raw = os.getenv("MSSQL_CONFIG", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"MSSQL_CONFIG is not valid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("MSSQL_CONFIG must be a JSON object")
    return parsed


_mssql = _load_mssql_config()

MSSQL_SERVER: str = _mssql.get("server", r"FWS-LP-1499\SQLSERVER2022")
MSSQL_DATABASE: str = _mssql.get("database", "CRMSalesPotentialls")
MSSQL_USERNAME: str = _mssql.get("username", "sa")
MSSQL_PASSWORD: str = _mssql.get("password", "")
MSSQL_DRIVER: str = _mssql.get("driver", "ODBC Driver 17 for SQL Server")

# ── JWT ──────────────────────────────────────────────────────────────────────
JWT_ALGORITHM: str = "HS256"
JWT_ACCESS_SECRET_KEY: str = os.getenv("JWT_ACCESS_SECRET_KEY", "changeme-access-secret")
JWT_REFRESH_SECRET_KEY: str = os.getenv("JWT_REFRESH_SECRET_KEY", "changeme-refresh-secret")
JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
JWT_REFRESH_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 30)))

# ── Microsoft Azure Delegated Access ────────────────────────────────────────
AZURE_INTEGRATION_CLIENT_ID: str = os.getenv("AZURE_INTEGRATION_CLIENT_ID", "")
AZURE_INTEGRATION_CLIENT_SECRET: str = os.getenv("AZURE_INTEGRATION_CLIENT_SECRET", "")
AZURE_INTEGRATION_TENANT_ID: str = os.getenv("AZURE_INTEGRATION_TENANT_ID", "common")

# ── SendGrid (OTP emails + support emails) ───────────────────────────────────
SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
SENDGRID_FROM_EMAIL: str = os.getenv("SENDGRID_FROM_EMAIL", "noreply@botatwork.com")
# Comma-separated list of support recipients
SUPPORT_EMAIL_TO: list[str] = [e.strip() for e in os.getenv("SUPPORT_EMAIL_TO", "").split(",") if e.strip()]

# ── OTP ──────────────────────────────────────────────────────────────────────
OTP_LENGTH: int = int(os.getenv("OTP_LENGTH", "6"))
OTP_EXPIRE_MINUTES: int = int(os.getenv("OTP_EXPIRE_MINUTES", "10"))

# ── Webhook ──────────────────────────────────────────────────────────────────
WEBHOOK_API_KEY: str = os.getenv("WEBHOOK_API_KEY", "")

# ── Frontend ─────────────────────────────────────────────────────────────────
FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")

# ── Google Cloud Storage ─────────────────────────────────────────────────────
GCS_BUCKET_NAME: str = os.getenv("GCS_BUCKET_NAME", "fws-sales-ai")
GCS_ENV: str = os.getenv("GCS_ENV", "dev")  # "dev" | "prod"

# ── Anthropic ────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-6")

# ── AgentFlow ─────────────────────────────────────────────────────────────────
# Configured via a single AGENTFLOW_CONFIG env var holding JSON, e.g.:
# AGENTFLOW_CONFIG='{"base_url":"http://localhost:8003","api_key":"...","callback_connection":"salezilla_webhook","graphs":{"new_potential":"...","meeting_brief":"...","follow_up":"...","reply":"...","stage_update":"..."}}'
def _load_agentflow_config() -> dict:
    raw = os.getenv("AGENTFLOW_CONFIG", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AGENTFLOW_CONFIG is not valid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("AGENTFLOW_CONFIG must be a JSON object")
    return parsed


_agentflow = _load_agentflow_config()
_graphs = _agentflow.get("graphs") or {}

AGENTFLOW_BASE_URL: str = _agentflow.get("base_url", "http://localhost:8003")
AGENTFLOW_API_KEY: str = _agentflow.get("api_key", "")
AGENTFLOW_CALLBACK_CONNECTION: str = _agentflow.get("callback_connection", "salezilla_webhook")
AGENTFLOW_GRAPH_NEW_POTENTIAL: str = _graphs.get("new_potential", "")
AGENTFLOW_GRAPH_MEETING_BRIEF: str = _graphs.get("meeting_brief", "")
AGENTFLOW_GRAPH_FOLLOW_UP: str = _graphs.get("follow_up", "")
AGENTFLOW_GRAPH_REPLY: str = _graphs.get("reply", "")
AGENTFLOW_GRAPH_STAGE_UPDATE: str = _graphs.get("stage_update", "")
AGENTFLOW_GRAPH_TODO_RECONCILE: str = _graphs.get("todo_reconcile", "")
AGENTFLOW_GRAPH_FOLLOW_UP_INACTIVE: str = _graphs.get("follow_up_inactive", "")
AGENTFLOW_GRAPH_NEWS: str = _graphs.get("news", "")
# Dedicated graph for the "Run Agent" buttons in the Research / Solution
# tabs. Chains research agents → solution agent and skips FRE / stage_update
# / attachment so a re-run doesn't recreate FRE drafts or queue items.
AGENTFLOW_GRAPH_RESEARCH_SOLUTION: str = _graphs.get("research_solution", "")

# ── Twilio (calling) ─────────────────────────────────────────────────────────
# Configured via a single TWILIO_CONFIG env var holding JSON, e.g.:
# TWILIO_CONFIG='{"account_sid":"AC...","auth_token":"...","calling_number":"+1...","api_key":"SK...","api_secret":"...","twiml_app_sid":"AP..."}'
def _load_twilio_config() -> dict:
    raw = os.getenv("TWILIO_CONFIG", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"TWILIO_CONFIG is not valid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("TWILIO_CONFIG must be a JSON object")
    return parsed


_twilio = _load_twilio_config()

TWILIO_ACCOUNT_SID: str = _twilio.get("account_sid", "")
TWILIO_AUTH_TOKEN: str = _twilio.get("auth_token", "")
TWILIO_CALLING_NUMBER: str = _twilio.get("calling_number", "")
TWILIO_API_KEY: str = _twilio.get("api_key", "")             # API Key SID for Access Token generation
TWILIO_API_SECRET: str = _twilio.get("api_secret", "")       # API Key Secret
TWILIO_TWIML_APP_SID: str = _twilio.get("twiml_app_sid", "")  # TwiML App for Client SDK routing
BASE_URL: str = os.getenv("BASE_URL", "http://localhost:8000")  # Public URL for Twilio webhooks
