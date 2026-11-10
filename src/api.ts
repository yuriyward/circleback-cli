import { CliError } from "./errors.ts";

export const BASE = "https://circleback.ai/api";
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export interface Person {
  name?: string | null;
  email?: string | null;
}
export interface Meeting {
  id: string;
  name?: string | null;
  createdAt?: string;
  duration?: number | null;
  attendees?: Person[] | null;
  notes?: string | null;
  privateNotes?: string | null;
  actionItems?: { title?: string | null; description?: string | null; assignee?: Person | null; status?: string | null }[] | null;
  recordingUrl?: string | null;
}
export interface Segment {
  speaker?: string | null;
  text?: string | null;
  timestamp?: number | null;
}
export interface ApiOptions {
  key: string;
  fetch: Fetch;
  /** Waits between 429 retries; tests pass a fake. */
  sleep: (ms: number) => Promise<void>;
}
const RETRIES = 4;
/** Codes a credential-holding proxy may answer with (`{"error":{"code"}}`); they pass through unchanged. */
const GATE = ["refused", "recording_too_large"];

export function failure(status: number, body: unknown): CliError {
  const b = body as { error?: unknown; code?: unknown } | null;
  const gate = typeof b?.error === "object" && b.error ? (b.error as { code?: unknown }).code : undefined;
  const upstream = typeof b?.code === "string" ? b.code : `http_${status}`;
  if (typeof gate === "string" && GATE.includes(gate)) {
    const message = gate === "refused" ? "The proxy refused this request (outside its policy)" : "The recording is larger than the proxy can return";
    return new CliError(gate, message, { details: { status } });
  }
  const code = status === 401 || status === 403 ? "unauthorized" : status === 404 ? "not_found" : status === 429 ? "throttled" : "api_error";
  const recovery =
    code === "unauthorized" ? "check CIRCLEBACK_API_KEY (Circleback Settings → API keys)" : code === "not_found" ? "circleback-cli meetings list" : undefined;
  const message = typeof b?.error === "string" ? b.error : `Circleback returned ${status}`;
  return new CliError(code, message.slice(0, 300), { details: { status, upstream }, ...(recovery ? { recovery } : {}) });
}
/** The `rel="next"` target of an RFC 8288 Link header, resolved against the request URL. */
export function nextLink(header: string | null, base: string) {
  for (const part of (header ?? "").split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (match && /;\s*rel="?(?:[^"]*\s)?next(?:\s[^"]*)?"?\s*(?:;|$)/i.test(match[2] ?? "")) {
      return new URL(match[1] as string, base).href;
    }
  }
}
/** Read-only Circleback REST client: GET only, 429 waits Retry-After and retries. */
export class Circleback {
  private readonly options: ApiOptions;
  constructor(options: ApiOptions) {
    this.options = options;
  }
  private async get(url: string): Promise<{ body: unknown; response: Response }> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.options.fetch(url, {
        headers: { accept: "application/json", authorization: `Bearer ${this.options.key}` },
        method: "GET",
        redirect: "error",
      });
      const raw = await response.text();
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        if (response.ok) {
          throw new CliError("api_error", `Circleback returned non-JSON (${response.status})`);
        }
      }
      if (response.status === 429 && attempt < RETRIES) {
        const after = Number(response.headers.get("retry-after"));
        await this.options.sleep(Math.min(Number.isFinite(after) && after >= 0 ? after * 1000 : 1000 * 2 ** attempt, 60_000));
        continue;
      }
      if (!response.ok) {
        throw failure(response.status, body);
      }
      return { body, response };
    }
  }
  /** One page of meetings; `next` is the Link target, checked to stay on the meetings list. */
  async page(url: string): Promise<{ meetings: Meeting[]; next: string | undefined }> {
    const { body, response } = await this.get(url);
    if (!Array.isArray(body) || !body.every((m) => typeof m?.id === "string" || typeof m?.id === "number")) {
      throw new CliError("api_error", "Circleback meetings list is not an array of meetings");
    }
    const next = nextLink(response.headers.get("link"), url);
    if (next && !next.startsWith(`${BASE}/meetings?`)) {
      throw new CliError("api_error", "Circleback paging left the meetings list");
    }
    return { meetings: body.map((m) => ({ ...m, id: String(m.id) })), next };
  }
  async meeting(id: string): Promise<Meeting> {
    const { body } = await this.get(`${BASE}/meeting/${id}`);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CliError("api_error", "Circleback meeting is not an object");
    }
    return { ...(body as Meeting), id };
  }
  async transcript(id: string): Promise<Segment[]> {
    const { body } = await this.get(`${BASE}/meeting/${id}/transcript`);
    if (!Array.isArray(body)) {
      throw new CliError("api_error", "Circleback transcript is not an array of segments");
    }
    return body as Segment[];
  }
}
