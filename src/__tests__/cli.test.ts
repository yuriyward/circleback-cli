import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Deps, run } from "../main.ts";

type Seen = { method: string; url: string; headers: Headers; signal?: AbortSignal | null | undefined };
const KEY = "synthetic-circleback-key";
const RECORDING = "https://storage.googleapis.com/circleback-recordings/m1.mp4?X-Goog-Signature=ab%2Fcd&X-Goog-Expires=86400";
const meeting = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  actionItems: [{ assignee: { email: "ann@example.com", name: "Ann Example" }, description: "Send the  draft\nby Friday", status: "PENDING", title: "Draft" }],
  attendees: [{ email: "ann@example.com", name: "Ann Example" }, { email: "bo@example.com", name: "Bo Sample" }],
  createdAt,
  duration: 1859.6,
  id,
  name: `Meeting ${id}`,
  notes: "#### Overview\n* Talked about the plan",
  privateNotes: "secret aside",
  recordingUrl: `https://storage.googleapis.com/circleback-recordings/${id}.mp4`,
  ...extra,
});
/** Unordered pages, as the API does not document an order. */
const PAGES = [
  [meeting("m2", "2026-11-08T10:00:00Z"), meeting("m0", "2026-11-06T22:59:00Z")],
  [meeting("m1", "2026-11-06T23:00:00Z", { recordingUrl: RECORDING }), meeting("m3", "2026-11-09T07:30:00Z")],
  [meeting("old", "2026-10-01T09:00:00Z")],
];
function fake(options: { transcript?: unknown[]; status?: (s: Seen) => Response | undefined } = {}) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const s = { headers: new Headers(init.headers), method: init.method ?? "GET", signal: init.signal, url };
    seen.push(s);
    const override = options.status?.(s);
    if (override) {
      return override;
    }
    const u = new URL(url);
    if (u.hostname === "storage.googleapis.com") {
      return new Response("video-bytes", { headers: { "content-type": "video/mp4" } });
    }
    if (u.pathname === "/api/meetings") {
      const page = Number(u.searchParams.get("cursor") ?? "0");
      const headers: Record<string, string> = page + 1 < PAGES.length ? { link: `<https://circleback.ai/api/meetings?cursor=${page + 1}>; rel="next"` } : {};
      return Response.json(PAGES[page], { headers });
    }
    const transcript = /^\/api\/meeting\/([\w-]+)\/transcript$/.exec(u.pathname);
    if (transcript) {
      return Response.json(options.transcript ?? [{ speaker: "Ann Example", text: "Where do you live now?", timestamp: 0.4 }, { speaker: "Bo Sample", text: "Krakow.", timestamp: 3725.2 }]);
    }
    const one = /^\/api\/meeting\/([\w-]+)$/.exec(u.pathname);
    const found = PAGES.flat().find((m) => m.id === one?.[1]);
    return found ? Response.json(found) : Response.json({ code: "NOT_FOUND", error: "Meeting not found" }, { status: 404 });
  };
  const deps: Deps = { deadlineMs: 2000, env: { CIRCLEBACK_API_KEY: KEY, TZ: "Europe/Warsaw" }, fetch, sleep: async () => undefined };
  return { cli: (argv: string[], more: Partial<Deps> = {}) => run(argv, { ...deps, ...more }), seen };
}
const json = (r: { stdout: string }) => JSON.parse(r.stdout);

describe("meetings list", () => {
  test("one page in compact text; the printed cursor continues to the last page", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "list"]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "m2  2026-11-08 11:00  31:00  Meeting m2  Ann Example, Bo Sample",
      "m0  2026-11-06 23:59  31:00  Meeting m0  Ann Example, Bo Sample",
    ]);
    const cursor = /--cursor (\S+)$/.exec(lines[2] ?? "")?.[1] as string;
    expect(lines[2]).toStartWith("complete: false; next: circleback-cli meetings list --cursor ");
    const ids: string[] = [];
    let next: string | null = cursor;
    while (next) {
      const page = json(await cli(["meetings", "list", "--cursor", next, "--json"]));
      ids.push(...page.meetings.map((m: { id: string }) => m.id));
      next = page.cursor;
      expect(page.complete).toBe(next === null);
    }
    expect(ids).toEqual(["m1", "m3", "old"]);
  });
  test("--limit inside a page continues on the same page instead of skipping the rest", async () => {
    const { cli } = fake();
    const first = json(await cli(["meetings", "list", "--limit", "1", "--json"]));
    expect([first.meetings[0].id, first.complete]).toEqual(["m2", false]);
    const second = json(await cli(["meetings", "list", "--limit", "1", "--cursor", first.cursor, "--json"]));
    expect(second.meetings[0].id).toBe("m0");
    const third = json(await cli(["meetings", "list", "--limit", "1", "--cursor", second.cursor, "--json"]));
    expect(third.meetings[0].id).toBe("m1");
  });
  test("--since scans every unordered page and keeps meetings from 00:00 in the zone, newest first", async () => {
    const { cli, seen } = fake();
    const r = json(await cli(["meetings", "list", "--since", "2026-11-07", "--json"]));
    expect(r.meetings.map((m: { id: string }) => m.id)).toEqual(["m3", "m2", "m1"]);
    expect(r).toMatchObject({ complete: true, cursor: null });
    expect(seen.length).toBe(3);
    expect(JSON.stringify(r)).not.toContain("storage.googleapis.com");
  });
  test("101 eligible meetings under --since: the first call is complete:false and its cursor returns the rest", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ createdAt: new Date(Date.UTC(2026, 10, 8, 0, i)).toISOString(), id: `x${String(i).padStart(3, "0")}`, name: "Synthetic" }));
    const { cli } = fake({
      status: (s) => {
        const u = new URL(s.url);
        if (u.pathname !== "/api/meetings") {
          return;
        }
        const page = Number(u.searchParams.get("cursor") ?? "0");
        const link = page < 2 ? { link: `<https://circleback.ai/api/meetings?cursor=${page + 1}>; rel="next"` } : undefined;
        // Unordered pages of 40, 40 and 21, plus one meeting before the cutoff.
        const body = page === 2 ? [...many.slice(80), { createdAt: "2026-10-01T00:00:00Z", id: "early" }] : many.slice(page * 40, page * 40 + 40).reverse();
        return Response.json(body, link ? { headers: link } : {});
      },
    });
    const first = json(await cli(["meetings", "list", "--since", "2026-11-07", "--json"]));
    expect([first.meetings.length, first.complete]).toEqual([100, false]);
    expect(first.meetings[0].id).toBe("x100");
    const rest = json(await cli(["meetings", "list", "--since", "2026-11-07", "--cursor", first.cursor, "--json"]));
    expect(rest).toMatchObject({ complete: true, cursor: null });
    const all = [...first.meetings, ...rest.meetings].map((m: { id: string }) => m.id);
    expect(new Set(all).size).toBe(101);
    expect(all.at(-1)).toBe("x000");
    // The cursor carries its date; a different --since is a usage error.
    const other = await cli(["meetings", "list", "--since", "2026-11-08", "--cursor", first.cursor, "--json"]);
    expect(JSON.parse(other.stderr).error.code).toBe("usage");
    expect(json(await cli(["meetings", "list", "--cursor", first.cursor, "--json"])).meetings.length).toBe(1);
  });
  test("429 waits Retry-After and retries; only GETs with the key are ever sent", async () => {
    let throttled = 0;
    const waits: number[] = [];
    const { cli, seen } = fake({
      status: (s) => (s.url.endsWith("/api/meetings") && throttled++ === 0 ? new Response("{}", { headers: { "retry-after": "2" }, status: 429 }) : undefined),
    });
    const r = await cli(["meetings", "list", "--json"], { sleep: async (ms: number) => void waits.push(ms) });
    expect(r.exitCode).toBe(0);
    expect(waits).toEqual([2000]);
    expect(seen.length).toBe(2);
    expect(seen.every((s) => s.method === "GET" && s.headers.get("authorization") === `Bearer ${KEY}`)).toBe(true);
  });
  test("--timezone overrides TZ for dates and the --since cutoff; an unknown zone is a usage error", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "list", "--timezone", "America/New_York"]);
    expect(r.stdout.split("\n")[0]).toBe("m2  2026-11-08 05:00  31:00  Meeting m2  Ann Example, Bo Sample");
    const since = json(await cli(["meetings", "list", "--since", "2026-11-06", "--timezone", "America/New_York", "--json"]));
    expect(since.meetings.map((m: { id: string }) => m.id)).toEqual(["m3", "m2", "m1", "m0"]);
    const utc = await cli(["meetings", "list"], { env: { CIRCLEBACK_API_KEY: KEY, TZ: ":UTC" } });
    expect(utc.stdout.split("\n")[0]).toContain("2026-11-08 10:00");
    const bad = await cli(["meetings", "list", "--timezone", "Mars/Olympus", "--json"]);
    expect([bad.exitCode, JSON.parse(bad.stderr).error.code]).toEqual([2, "usage"]);
  });
  test("usage errors name the fix", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "list", "--since", "2026-02-30", "--json"]);
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.stderr).error).toMatchObject({ code: "usage", recovery: "circleback-cli --help" });
    const forged = await cli(["meetings", "list", "--cursor", "1", "--json"]);
    expect(JSON.parse(forged.stderr).error.code).toBe("usage");
    const unknown = await cli(["meetings", "delete", "--id", "m1"]);
    expect(unknown.stderr).toContain("error usage: Unknown command");
  });
});
describe("reads", () => {
  test("meetings read hides private notes unless --private and never prints the recording link", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "read", "--id", "m1"]);
    expect(r.stdout).toContain("## Notes\n#### Overview");
    expect(r.stdout).toContain("- Draft (Ann Example): Send the draft by Friday");
    expect(r.stdout).not.toContain("secret aside");
    expect(r.stdout).not.toContain("googleapis");
    const priv = json(await cli(["meetings", "read", "--id", "m1", "--private", "--json"]));
    expect(priv.meeting.privateNotes).toBe("secret aside");
    expect(priv.meeting.hasRecording).toBe(true);
    expect(JSON.stringify(priv)).not.toContain("X-Goog");
  });
  test("transcripts read prints [m:ss] and [h:mm:ss] speaker lines", async () => {
    const { cli } = fake();
    expect((await cli(["transcripts", "read", "--id", "m1"])).stdout).toBe(
      "[0:00] **Ann Example**: Where do you live now?\n[1:02:05] **Bo Sample**: Krakow.\n",
    );
  });
  test("without a key the error names how to get one", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "list", "--json"], { env: {} });
    expect(JSON.parse(r.stderr).error).toMatchObject({ code: "auth_missing" });
    expect(JSON.parse(r.stderr).error.recovery).toContain("CIRCLEBACK_API_KEY");
  });
  test("a missing meeting is not_found with the list command", async () => {
    const { cli } = fake();
    const r = await cli(["meetings", "read", "--id", "nope", "--json"]);
    expect(JSON.parse(r.stderr).error).toMatchObject({ code: "not_found", recovery: "circleback-cli meetings list" });
  });
});

describe("files", () => {
  test("meetings export writes circleback-<id>.md in the manual-export shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-export-"));
    try {
      const { cli } = fake();
      const r = json(await cli(["meetings", "export", "--id", "m1", "--out", dir, "--json"]));
      expect(r).toMatchObject({ complete: true, id: "m1", path: join(dir, "circleback-m1.md") });
      expect(await readFile(join(dir, "circleback-m1.md"), "utf8")).toBe(
        [
          "# Meeting m1",
          "**Date**: Saturday, November 7, 2026 at 12:00 AM",
          "**Duration**: 31:00",
          "**People**: Ann Example, Bo Sample",
          "**Circleback**: m1",
          "",
          "## Notes",
          "#### Overview\n* Talked about the plan",
          "",
          "## Action items",
          "- Draft (Ann Example): Send the draft by Friday",
          "",
          "## Transcript",
          "[0:00] **Ann Example**: Where do you live now?",
          "[1:02:05] **Bo Sample**: Krakow.",
          "",
        ].join("\n"),
      );
      expect(await readdir(dir)).toEqual(["circleback-m1.md"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
  test("an empty transcript is not_ready (exit 5) and writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-export-"));
    try {
      const { cli } = fake({ transcript: [] });
      const r = await cli(["meetings", "export", "--id", "m1", "--out", dir, "--json"]);
      expect(r.exitCode).toBe(5);
      expect(JSON.parse(r.stderr).error.code).toBe("not_ready");
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
  test("recordings download streams the signed URL with no Authorization and never prints it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-rec-"));
    try {
      const { cli, seen } = fake();
      const r = await cli(["recordings", "download", "--id", "m1", "--out", dir, "--json"]);
      expect(json(r)).toMatchObject({ bytes: 11, complete: true, path: join(dir, "circleback-m1.mp4"), type: "video/mp4" });
      expect(r.stdout).not.toContain("X-Goog");
      const storage = seen.filter((s) => s.url.startsWith("https://storage.googleapis.com/"));
      expect(storage.map((s) => s.url)).toEqual([RECORDING]);
      expect(storage[0]?.headers.has("authorization")).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
  test("an oversized or slow recording fails retryably and leaves no file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-rec-"));
    try {
      const big = fake({
        status: (s) => (s.url.includes("storage") ? Response.json({ error: { code: "recording_too_large" } }, { status: 413 }) : undefined),
      });
      const r = await big.cli(["recordings", "download", "--id", "m1", "--out", dir, "--json"]);
      expect([r.exitCode, JSON.parse(r.stderr).error.code]).toEqual([5, "recording_too_large"]);
      const slow = fake({
        status: (s) =>
          s.url.includes("storage")
            ? new Response(new ReadableStream({
                  start: (c) => {
                    c.enqueue(new Uint8Array(3));
                    s.signal?.addEventListener("abort", () => c.error(s.signal?.reason));
                  },
                }), { headers: { "content-type": "video/mp4" } })
            : undefined,
      });
      const t = await slow.cli(["recordings", "download", "--id", "m1", "--out", dir, "--json"], { deadlineMs: 200 });
      expect(JSON.parse(t.stderr).error.code).toBe("recording_timeout");
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
