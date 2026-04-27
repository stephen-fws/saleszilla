/**
 * Outlook / Exchange file-type attachment policy.
 *
 * Microsoft Outlook (and Exchange Online) blocks a fixed set of file
 * extensions from being sent or received as attachments — they're treated as
 * "Level 1" unsafe (executables, scripts, shortcuts that auto-launch, etc.).
 *
 * If we send these via Graph the request itself succeeds, but the recipient's
 * server strips/quarantines the attachment — and our UI sits on "Sending…"
 * forever waiting for a Graph error that never arrives.
 *
 * Blocking client-side gives instant, honest feedback. Backend validation
 * (in /send-email) is the defence-in-depth line.
 *
 * Source: https://learn.microsoft.com/en-us/exchange/troubleshoot/security/blocked-attachments-in-outlook
 */
export const OUTLOOK_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
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
]);

/**
 * Returns the lowercase extension (without the dot) for a filename, or "" if
 * no extension. Handles names like ".env" (no extension) and "archive.tar.gz"
 * (returns "gz" — only the last segment matters for Outlook's policy).
 */
export function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * Validate a single file against the Outlook attachment policy. Returns a
 * human-readable error message if blocked, or null if the file is allowed.
 */
export function validateAttachmentFile(file: File): string | null {
  const ext = fileExtension(file.name);
  if (ext && OUTLOOK_BLOCKED_EXTENSIONS.has(ext)) {
    return `${file.name} — .${ext} files aren't allowed by Outlook (blocked attachment type).`;
  }
  return null;
}

/**
 * Outlook / Exchange Online default attachment size cap. Senders can be
 * configured up to 150 MB but 25 MB is the Microsoft 365 default and the
 * cap most external recipients will accept.
 */
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

/** Human-readable byte size: "1.2 KB", "10.5 MB", etc. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}
