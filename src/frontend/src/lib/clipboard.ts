/**
 * Copy text to clipboard with a fallback for non-secure contexts (HTTP).
 * navigator.clipboard is only available on HTTPS / localhost. On plain HTTP
 * we fall back to the legacy document.execCommand("copy") approach.
 */
export function copyToClipboard(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => _execCommandCopy(text));
  } else {
    _execCommandCopy(text);
  }
}

function _execCommandCopy(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch { /* ignore */ }
  document.body.removeChild(el);
}
