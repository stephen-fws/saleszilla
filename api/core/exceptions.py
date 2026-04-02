from typing import Any


class BotApiException(Exception):
    """Structured API exception with HTTP status code and machine-readable code."""

    def __init__(
        self,
        code: int = 500,
        message_code: str = "ERR_INTERNAL",
        message: str = "An unexpected error occurred.",
        data: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.status = "ERROR"
        self.message_code = message_code
        self.message = message
        self.data = data
        self.headers = headers or {}
        super().__init__(message)
