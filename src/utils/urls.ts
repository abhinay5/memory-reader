const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "igshid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "ref", "ref_src", "ref_url",
  "cmpid", "ncid", "sr_share", "s_cid", "spm", "vero_id", "oly_enc_id", "oly_anon_id",
  "__s", "si", "smid", "at_medium", "at_campaign", "trk", "trkcampaign",
]);

/**
 * Canonical identity for a page: drops fragments (unless they look like client-side routes),
 * tracking parameters and trailing slashes, and sorts remaining query parameters.
 * Meaningful query parameters (e.g. `?id=123`) are preserved.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim();
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  const keep: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || TRACKING_PARAMS.has(k)) return;
    keep.push([key, value]);
  });
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = keep.length ? "?" + new URLSearchParams(keep).toString() : "";
  if (!(url.hash.startsWith("#/") || url.hash.startsWith("#!"))) url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

/** Only ordinary web pages can host highlights; chrome://, the Web Store, PDFs etc. cannot. */
export function isSupportedPageUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.hostname === "chromewebstore.google.com") return false;
    if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) return false;
    return true;
  } catch {
    return false;
  }
}
