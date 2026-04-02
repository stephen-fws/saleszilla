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

# ── SendGrid (OTP emails) ────────────────────────────────────────────────────
SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
SENDGRID_FROM_EMAIL: str = os.getenv("SENDGRID_FROM_EMAIL", "noreply@botatwork.com")

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
