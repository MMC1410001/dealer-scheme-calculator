/**
 * Strict parsing of the token request body (POST /api/v1/auth/token).
 *
 * - application/x-www-form-urlencoded (RFC 6749) or application/json (an object of strings).
 * - The bytes must be valid UTF-8 (TextDecoder with fatal: true).
 * - A parameter sent more than once is refused. JSON.parse keeps the last of repeated keys, so a second
 *   client_secret could win; this parser detects repeated keys at every level.
 * - A value with an unpaired surrogate (for example "\ud800" in JSON) is refused.
 */

export type TokenBodyResult = { ok: true; params: Map<string, string> } | { ok: false; description: string };

export const DESC_CONTENT_TYPE = "Send application/x-www-form-urlencoded or application/json";
export const DESC_UNPARSABLE = "The body could not be parsed";
export const DESC_REPEATED = "A parameter was sent more than once";
export const DESC_NOT_OBJECT = "The JSON body must be an object of strings";
export const DESC_NOT_UTF8 = "Parameters must be valid UTF-8";

export type TokenBodyType = "form" | "json" | null;

export function tokenBodyType(contentType: string | null): TokenBodyType {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (t === "application/x-www-form-urlencoded") return "form";
  if (t === "application/json") return "json";
  return null;
}

class RepeatedKey extends Error {}
class Unparsable extends Error {}

const MAX_DEPTH = 32;

/** Recursive-descent JSON parser (RFC 8259) that refuses repeated object keys. */
function parseStrictJson(text: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const fail = (): never => {
    throw new Unparsable();
  };
  const str = (): string => {
    if (text[i] !== '"') fail();
    let j = i + 1;
    // Find the closing quote, skipping escapes; JSON.parse then decodes the escapes exactly.
    while (j < text.length && text[j] !== '"') {
      if (text[j] === "\\") j++;
      else if (text.charCodeAt(j) < 0x20) fail();
      j++;
    }
    if (j >= text.length) fail();
    const raw = text.slice(i, j + 1);
    i = j + 1;
    try {
      return JSON.parse(raw) as string;
    } catch {
      return fail();
    }
  };
  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail();
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      const seen = new Set<string>();
      ws();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const k = str();
        if (seen.has(k)) throw new RepeatedKey();
        seen.add(k);
        ws();
        if (text[i] !== ":") fail();
        i++;
        Object.defineProperty(obj, k, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return obj;
        }
        fail();
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return arr;
        }
        fail();
      }
    }
    if (c === '"') return str();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) return fail();
    i += m[0].length;
    return JSON.parse(m[0]);
  };
  const v = value(0);
  ws();
  if (i !== text.length) fail();
  return v;
}

function wellFormed(s: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** Form decoding: "+" is a space, then percent-decoding as UTF-8. Throws URIError on a bad sequence. */
export function formDecode(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, " "));
}

export function parseTokenBody(type: Exclude<TokenBodyType, null>, bytes: Uint8Array): TokenBodyResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, description: DESC_UNPARSABLE };
  }
  const pairs: Array<[string, string]> = [];
  if (type === "form") {
    for (const part of text.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      try {
        pairs.push(eq < 0 ? [formDecode(part), ""] : [formDecode(part.slice(0, eq)), formDecode(part.slice(eq + 1))]);
      } catch {
        return { ok: false, description: DESC_NOT_UTF8 };
      }
    }
  } else {
    let data: unknown;
    try {
      data = parseStrictJson(text);
    } catch (err) {
      return { ok: false, description: err instanceof RepeatedKey ? DESC_REPEATED : DESC_UNPARSABLE };
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, description: DESC_NOT_OBJECT };
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== "string") return { ok: false, description: DESC_NOT_OBJECT };
      pairs.push([k, v]);
    }
  }
  for (const [k, v] of pairs) {
    if (!wellFormed(k) || !wellFormed(v)) return { ok: false, description: DESC_NOT_UTF8 };
  }
  const params = new Map<string, string>();
  for (const [k, v] of pairs) {
    if (params.has(k)) return { ok: false, description: DESC_REPEATED };
    params.set(k, v);
  }
  return { ok: true, params };
}
