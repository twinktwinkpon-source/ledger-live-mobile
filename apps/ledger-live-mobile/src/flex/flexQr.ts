/**
 * Parses the scanned flex QR payload into {key, server}.
 * Expected format: ledgerflex://activate?key=FLEX-...&server=http://...
 * Also handles bare FLEX- keys and URLs containing key=.
 *
 * Shared by the settings scanner and the first-boot scan gate so both parse
 * the desktop admin QR identically.
 */
export function extractFlexData(data: string): { key: string | null; server: string | null } {
  try {
    const trimmed = (data || "").trim();
    if (trimmed.startsWith("ledgerflex://")) {
      const q = trimmed.indexOf("?");
      const query = q >= 0 ? trimmed.slice(q + 1) : "";
      let key: string | null = null;
      let server: string | null = null;
      for (const pair of query.split("&")) {
        if (pair.startsWith("key=")) key = decodeURIComponent(pair.slice(4)) || null;
        else if (pair.startsWith("server=")) server = decodeURIComponent(pair.slice(4)) || null;
      }
      return { key, server };
    }
    if (trimmed.startsWith("FLEX-")) {
      return { key: trimmed.split("?")[0], server: null };
    }
    const m = trimmed.match(/key=([^&]+)/);
    if (m) {
      const sm = trimmed.match(/server=([^&]+)/);
      return {
        key: decodeURIComponent(m[1]),
        server: sm ? decodeURIComponent(sm[1]) : null,
      };
    }
    return { key: null, server: null };
  } catch {
    return { key: null, server: null };
  }
}
