"""Outlook / Exchange attachment policy.

Microsoft blocks a fixed set of file extensions ("Level 1" unsafe types) from
being sent via Outlook / Exchange Online. Sending one through Graph succeeds
but the recipient server strips the attachment, leaving the user wondering
why nothing arrived.

Mirrors `ui/src/lib/attachments.ts` — keep these in sync if Outlook updates
the list. Source:
https://learn.microsoft.com/en-us/exchange/troubleshoot/security/blocked-attachments-in-outlook
"""

OUTLOOK_BLOCKED_EXTENSIONS: frozenset[str] = frozenset({
    "ade", "adp", "app", "application", "appref-ms", "asp", "aspx", "asx",
    "bas", "bat",
    "cer", "chm", "cmd", "cnt", "com", "cpl", "crt", "csh",
    "der", "diagcab", "diagcfg", "diagpkg",
    "exe",
    "fxp",
    "gadget", "grp",
    "hlp", "hpj", "hta", "htc",
    "inf", "ins", "iso", "isp", "its",
    "jar", "jnlp", "js", "jse",
    "ksh",
    "lnk",
    "mad", "maf", "mag", "mam", "maq", "mar", "mas", "mat", "mau", "mav", "maw",
    "mcf", "mda", "mdb", "mde", "mdt", "mdw", "mdz",
    "msc", "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml",
    "msi", "msp", "mst", "msu",
    "ops", "osd",
    "pcd", "pif", "pl", "plg", "prf", "prg", "printerexport", "ps1",
    "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psd1", "psdm1", "pst", "py",
    "pyc", "pyo", "pyw", "pyz", "pyzw",
    "reg",
    "scf", "scr", "sct", "shb", "shs",
    "theme", "tmp",
    "url",
    "vb", "vbe", "vbp", "vbs", "vhd", "vhdx", "vsmacros", "vsw",
    "webpnp", "website", "ws", "wsc", "wsf", "wsh",
    "xbap", "xll", "xnk",
})


def _extension(filename: str) -> str:
    """Return the lowercase extension (no dot), or '' if none."""
    if not filename:
        return ""
    idx = filename.rfind(".")
    if idx <= 0 or idx == len(filename) - 1:
        return ""
    return filename[idx + 1:].lower()


def is_blocked_attachment(filename: str) -> bool:
    """Whether `filename` has a blocked Outlook extension."""
    ext = _extension(filename)
    return bool(ext) and ext in OUTLOOK_BLOCKED_EXTENSIONS


def first_blocked_name(filenames: list[str]) -> str | None:
    """Return the first filename in `filenames` that is blocked, else None."""
    for name in filenames:
        if is_blocked_attachment(name):
            return name
    return None


# ── Size policy ──────────────────────────────────────────────────────────────

# Outlook / Exchange Online default cap. Tenants can raise up to 150 MB but
# 25 MB is the Microsoft 365 default and the cap most external recipients
# accept, so it's the safe fence to enforce.
MAX_ATTACHMENT_TOTAL_BYTES: int = 25 * 1024 * 1024


def _b64_decoded_size(b64: str | None) -> int:
    """Approximate decoded byte size of a base64 string without allocating
    the decoded bytes (cheap when many large attachments are present)."""
    if not b64:
        return 0
    s = b64.strip()
    if not s:
        return 0
    # base64 = ceil(n / 3) * 4 chars; padding '=' chars represent absent bytes.
    padding = 0
    if s.endswith("=="):
        padding = 2
    elif s.endswith("="):
        padding = 1
    return (len(s) * 3 // 4) - padding


def total_attachment_bytes(attachments: list[dict]) -> int:
    """Sum the decoded byte sizes of a list of {name, content_bytes} dicts.

    Mirrors the shape we pass to send_mail_via_graph (`content_bytes` is a
    base64 string)."""
    return sum(_b64_decoded_size(a.get("content_bytes")) for a in attachments)


def format_bytes(num: int) -> str:
    if num <= 0:
        return "0 B"
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024:
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024  # type: ignore[assignment]
    return f"{num:.1f} TB"
