import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { BASE, type Circleback, type Fetch, failure, type Meeting, type Segment } from "./api.ts";
import { allowOnly, limit, meetingId, type Parsed, since } from "./args.ts";
import { CliError, usage } from "./errors.ts";
import { actionLines, listLine, longDate, markdown, midnight, people, transcriptLines } from "./format.ts";

export interface Output {
  json: Record<string, unknown>;
  text: string;
}
/** Pages one `--since` scan reads; more fails rather than silently stopping. */
const MAX_PAGES = 200;
const summary = (m: Meeting) => ({
  attendees: (m.attendees ?? []).map((a) => a?.name || a?.email || "").filter(Boolean),
  createdAt: m.createdAt ?? null,
  duration: typeof m.duration === "number" ? Math.round(m.duration) : null,
  hasRecording: typeof m.recordingUrl === "string" && m.recordingUrl.length > 0,
  id: m.id,
  name: m.name ?? null,
});
/**
 * The `--cursor` we print: in a `--since` scan, the date and the last meeting returned (newest first,
 * so later or removed meetings never shift what remains); else Circleback's page cursor and a skip.
 */
type Cursor = { s: string; t: number; i: string } | { p: string | null; k: number };
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function decode(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof c?.s === "string" && Number.isFinite(c.t) && typeof c.i === "string") {
      return { i: c.i, s: c.s, t: c.t };
    }
    if ((c?.p === null || typeof c?.p === "string") && Number.isSafeInteger(c.k) && c.k >= 0) {
      return { k: c.k, p: c.p };
    }
  } catch {
    // Reported below.
  }
  throw usage("--cursor must be the cursor a previous `meetings list` printed", "circleback-cli meetings list");
}
const upstreamCursor = (next: string | undefined) => (next ? new URL(next).searchParams.get("cursor") : null);
const time = (m: Meeting) => Date.parse(m.createdAt ?? "");
/** Newest first; ties by id, so the order is total and a cursor position is exact. */
const newerFirst = (a: Meeting, b: Meeting) => time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const pageUrl = (cursor: string | null) => (cursor === null ? `${BASE}/meetings` : `${BASE}/meetings?cursor=${encodeURIComponent(cursor)}`);
function listOutput(zone: string, meetings: Meeting[], next: Cursor | null): Output {
  const cursor = next ? encode(next) : null;
  const tail = cursor ? `complete: false; next: circleback-cli meetings list --cursor ${cursor}` : "complete: true";
  return {
    json: { complete: !cursor, cursor, meetings: meetings.map(summary) },
    text: `${[...meetings.map((m) => listLine(zone, m)), tail].join("\n")}\n`,
  };
}
/** Every page, kept from 00:00 that day in `zone`, newest first, after the cursor's meeting. */
async function sinceList(api: Circleback, zone: string, day: { y: number; m: number; d: number }, after: { t: number; i: string } | undefined, max: number) {
  const found = new Map<string, Meeting>();
  let url: string | undefined = pageUrl(null);
  for (let pages = 0; url; pages += 1) {
    if (pages === MAX_PAGES) {
      throw new CliError("api_error", `Circleback returned more than ${MAX_PAGES} pages of meetings`);
    }
    const page = await api.page(url);
    for (const m of page.meetings) {
      found.set(m.id, m);
    }
    url = page.next;
  }
  const cutoff = midnight(zone, day);
  const kept = [...found.values()]
    .filter((m) => time(m) >= cutoff)
    .sort(newerFirst)
    .filter((m) => !after || newerFirst({ createdAt: new Date(after.t).toISOString(), id: after.i }, m) < 0);
  const shown = kept.slice(0, max);
  const last = shown.at(-1);
  const s = `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
  return listOutput(zone, shown, kept.length > max && last ? { i: last.id, s, t: time(last) } : null);
}

/**
 * Without `--since`: one Circleback page from the cursor. With `--since` (or its cursor): every page,
 * filtered and sorted. Either way `--limit` never drops a meeting: the rest follows `--cursor`.
 */
export async function meetingsList(api: Circleback, zone: string, parsed: Parsed): Promise<Output> {
  allowOnly(parsed, ["since", "limit", "cursor"]);
  const raw = parsed.flags.get("cursor");
  const cursor = raw === undefined ? undefined : decode(raw);
  let day = since(parsed);
  if (cursor && "s" in cursor) {
    const [y, m, d] = cursor.s.split("-").map(Number) as [number, number, number];
    if (day && (day.y !== y || day.m !== m || day.d !== d)) {
      throw usage("--cursor belongs to another --since date; drop --since or the cursor", "circleback-cli meetings list --cursor <c>");
    }
    day = { d, m, y };
  } else if (cursor && day) {
    throw usage("--since scans from the first page; drop --cursor", "circleback-cli meetings list --since <YYYY-MM-DD>");
  }
  const max = limit(parsed, day ? 100 : 25);
  if (day) {
    return sinceList(api, zone, day, cursor && "s" in cursor ? cursor : undefined, max);
  }
  const at = cursor && "p" in cursor ? cursor : { k: 0, p: null };
  const page = await api.page(pageUrl(at.p));
  const rest = page.meetings.slice(at.k);
  if (rest.length > max) {
    return listOutput(zone, rest.slice(0, max), { k: at.k + max, p: at.p });
  }
  const next = upstreamCursor(page.next);
  if (page.next && next === null) {
    throw new CliError("api_error", "Circleback's next page link carries no cursor");
  }
  return listOutput(zone, rest, page.next ? { k: 0, p: next } : null);
}
export async function meetingsRead(api: Circleback, zone: string, parsed: Parsed): Promise<Output> {
  allowOnly(parsed, ["id", "private"]);
  const m = await api.meeting(meetingId(parsed));
  const priv = parsed.bools.has("private");
  const actions = actionLines(m);
  const text = [
    `# ${m.name ?? "(untitled)"}`,
    `Date: ${longDate(zone, m.createdAt)} (${zone})`,
    `Duration: ${summary(m).duration ?? "?"} s`,
    `People: ${people(m)}`,
    `Recording: ${summary(m).hasRecording ? `yes (circleback-cli recordings download --id ${m.id})` : "no"}`,
    "",
    "## Notes",
    (m.notes ?? "").trim(),
    ...(priv ? ["", "## Private notes", (m.privateNotes ?? "").trim()] : []),
    "",
    "## Action items",
    ...(actions.length ? actions : ["(none)"]),
  ];
  return {
    json: {
      meeting: {
        ...summary(m),
        actionItems: (m.actionItems ?? []).map((a) => ({
          assignee: a?.assignee ? { email: a.assignee.email ?? null, name: a.assignee.name ?? null } : null,
          description: a?.description ?? null,
          status: a?.status ?? null,
          title: a?.title ?? null,
        })),
        attendees: (m.attendees ?? []).map((a) => ({ email: a?.email ?? null, name: a?.name ?? null })),
        notes: m.notes ?? null,
        ...(priv ? { privateNotes: m.privateNotes ?? null } : {}),
      },
    },
    text: `${text.join("\n")}\n`,
  };
}
/** Readiness (ADR-0002): an empty transcript is not ready; nothing is written. */
async function readyTranscript(api: Circleback, id: string): Promise<Segment[]> {
  const segments = await api.transcript(id);
  if (!segments.length) {
    throw new CliError("not_ready", `Meeting ${id} has no transcript yet`, { recovery: `run the same command later` });
  }
  return segments;
}
export async function transcriptsRead(api: Circleback, parsed: Parsed): Promise<Output> {
  allowOnly(parsed, ["id"]);
  const id = meetingId(parsed);
  const segments = await readyTranscript(api, id);
  return {
    json: { id, segments: segments.map((s) => ({ speaker: s.speaker ?? null, text: s.text ?? null, timestamp: s.timestamp ?? null })) },
    text: `${transcriptLines(segments).join("\n")}\n`,
  };
}
/** Writes beside the final name, then renames: a crash never leaves a short file under the final name. */
async function install(directory: string, name: string, write: (handle: Awaited<ReturnType<typeof open>>) => Promise<number>) {
  const path = join(directory, name);
  const part = `${path}.part`;
  await rm(part, { force: true });
  const handle = await open(part, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const bytes = await write(handle);
    await handle.close();
    await rename(part, path);
    return { bytes, path };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(part, { force: true });
    throw error;
  }
}
export async function meetingsExport(api: Circleback, zone: string, parsed: Parsed): Promise<Output> {
  allowOnly(parsed, ["id", "out"]);
  const id = meetingId(parsed);
  const meeting = await api.meeting(id);
  const segments = await readyTranscript(api, id);
  const data = Buffer.from(markdown(zone, meeting, segments));
  const { bytes, path } = await install(parsed.flags.get("out") ?? ".", `circleback-${id}.md`, async (h) => {
    await h.writeFile(data);
    return data.length;
  });
  const receipt = { bytes, complete: true, id, path };
  return { json: receipt, text: `${JSON.stringify(receipt)}\n` };
}
const TYPES: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
function extension(type: string, url: string) {
  return TYPES[type] ?? /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? "bin";
}
/**
 * Streams the meeting's recording to `circleback-<id>.<ext>`. The signed URL is a bearer link and is
 * never printed; no Authorization goes to the storage host. Full disk or the deadline fail retryably.
 */
export async function recordingsDownload(api: Circleback, deps: { fetch: Fetch; deadlineMs: number }, parsed: Parsed): Promise<Output> {
  allowOnly(parsed, ["id", "out"]);
  const id = meetingId(parsed);
  const url = (await api.meeting(id)).recordingUrl;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new CliError("no_recording", `Meeting ${id} has no recording`, { recovery: `circleback-cli meetings read --id ${id}` });
  }
  const signal = AbortSignal.timeout(deps.deadlineMs);
  try {
    const response = await deps.fetch(url, { headers: { accept: "*/*" }, method: "GET", redirect: "error", signal });
    if (!response.ok || !response.body) {
      throw failure(response.status, await response.json().catch(() => null));
    }
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const { bytes, path } = await install(parsed.flags.get("out") ?? ".", `circleback-${id}.${extension(type, url)}`, async (h) => {
      let size = 0;
      for await (const chunk of response.body as ReadableStream<Uint8Array>) {
        await h.write(chunk);
        size += chunk.length;
      }
      return size;
    });
    const receipt = { bytes, complete: true, id, path, type: type || null };
    return { json: receipt, text: `${JSON.stringify(receipt)}\n` };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (signal.aborted) {
      throw new CliError("recording_timeout", `The recording did not finish within ${deps.deadlineMs / 1000} s`, { recovery: "run the same command again" });
    }
    if (code === "ENOSPC" || code === "EFBIG") {
      throw new CliError("recording_too_large", "The recording does not fit the available space", { recovery: "run the same command again later" });
    }
    throw error;
  }
}
