#!/usr/bin/env bun
import { Circleback, type Fetch } from "./api.ts";
import { parseArgs, timezone } from "./args.ts";
import { meetingsExport, meetingsList, meetingsRead, type Output, recordingsDownload, transcriptsRead } from "./commands.ts";
import { CliError, usage } from "./errors.ts";
import { HELP, help } from "./help.ts";

export const SCHEMA_VERSION = 1;
export interface Deps {
  env: Record<string, string | undefined>;
  fetch: Fetch;
  sleep: (ms: number) => Promise<void>;
  /** Recording download deadline; under a proxy with its own deadline, keep this shorter. */
  deadlineMs: number;
}
export interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}
const defaults: Deps = {
  deadlineMs: 90_000,
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => Bun.sleep(ms),
};
async function dispatch(argv: string[], deps: Deps): Promise<Output> {
  const parsed = parseArgs(argv);
  const key = parsed.words.join(" ");
  if (parsed.bools.has("help") || !parsed.words.length) {
    return { json: { help: help(key) }, text: help(key) };
  }
  const zone = () => timezone(parsed, deps.env);
  const commands: Record<string, (api: Circleback) => Promise<Output>> = {
    "meetings export": (api) => meetingsExport(api, zone(), parsed),
    "meetings list": (api) => meetingsList(api, zone(), parsed),
    "meetings read": (api) => meetingsRead(api, zone(), parsed),
    "recordings download": (api) => recordingsDownload(api, deps, parsed),
    "transcripts read": (api) => transcriptsRead(api, parsed),
  };
  const command = commands[key];
  if (!command) {
    throw usage(`Unknown command ${JSON.stringify(key)}`);
  }
  const apiKey = deps.env.CIRCLEBACK_API_KEY;
  if (!apiKey) {
    throw new CliError("auth_missing", "CIRCLEBACK_API_KEY is not set", { recovery: "create a read-only key in Circleback Settings → API keys and export CIRCLEBACK_API_KEY" });
  }
  return command(new Circleback({ fetch: deps.fetch, key: apiKey, sleep: deps.sleep }));
}
export async function run(argv: string[], overrides: Partial<Deps> = {}): Promise<Result> {
  const deps = { ...defaults, ...overrides };
  const json = argv.includes("--json");
  try {
    const out = await dispatch(argv, deps);
    return { exitCode: 0, stderr: "", stdout: json ? `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...out.json })}\n` : out.text };
  } catch (error) {
    const e =
      error instanceof CliError
        ? error
        : new CliError(error instanceof TypeError ? "network" : "internal", error instanceof Error ? error.message.slice(0, 200) : "failed");
    const stderr = json
      ? `${JSON.stringify({ error: { code: e.code, message: e.message, recovery: e.recovery ?? null, ...e.details }, schemaVersion: SCHEMA_VERSION })}\n`
      : `error ${e.code}: ${e.message}${e.recovery ? `\ntry: ${e.recovery}` : ""}\n`;
    return { exitCode: e.exitCode, stderr, stdout: "" };
  }
}
export { HELP };
if (import.meta.main) {
  const result = await run(Bun.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
