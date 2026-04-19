import os

from dotenv import load_dotenv

load_dotenv()

# ── Application ──────────────────────────────────────────────────────────────
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# ── SQL Server ───────────────────────────────────────────────────────────────
MSSQL_SERVER: str = os.getenv("MSSQL_SERVER", r"FWS-LP-1499\SQLSERVER2022")
MSSQL_DATABASE: str = os.getenv("MSSQL_DATABASE", "CRMSalesPotentialls")
MSSQL_USERNAME: str = os.getenv("MSSQL_USERNAME", "sa")
MSSQL_PASSWORD: str = os.getenv("MSSQL_PASSWORD", "")
MSSQL_DRIVER: str = os.getenv("MSSQL_DRIVER", "ODBC Driver 17 for SQL Server")

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
AGENTFLOW_BASE_URL: str = os.getenv("AGENTFLOW_BASE_URL", "http://localhost:8003")
AGENTFLOW_API_KEY: str = os.getenv("AGENTFLOW_API_KEY", "")
AGENTFLOW_CALLBACK_CONNECTION: str = os.getenv("AGENTFLOW_CALLBACK_CONNECTION", "salezilla_webhook")
AGENTFLOW_GRAPH_NEW_POTENTIAL: str = os.getenv("AGENTFLOW_GRAPH_NEW_POTENTIAL", "")
AGENTFLOW_GRAPH_MEETING_BRIEF: str = os.getenv("AGENTFLOW_GRAPH_MEETING_BRIEF", "")
AGENTFLOW_GRAPH_FOLLOW_UP: str = os.getenv("AGENTFLOW_GRAPH_FOLLOW_UP", "")
AGENTFLOW_GRAPH_REPLY: str = os.getenv("AGENTFLOW_GRAPH_REPLY", "")
AGENTFLOW_GRAPH_STAGE_UPDATE: str = os.getenv("AGENTFLOW_GRAPH_STAGE_UPDATE", "")

# ── Twilio (calling) ─────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_CALLING_NUMBER: str = os.getenv("TWILIO_CALLING_NUMBER", "")
TWILIO_API_KEY: str = os.getenv("TWILIO_API_KEY", "")         # API Key SID for Access Token generation
TWILIO_API_SECRET: str = os.getenv("TWILIO_API_SECRET", "")   # API Key Secret
TWILIO_TWIML_APP_SID: str = os.getenv("TWILIO_TWIML_APP_SID", "")  # TwiML App for Client SDK routing
BASE_URL: str = os.getenv("BASE_URL", "http://localhost:8000")  # Public URL for Twilio webhooks
