import { usage } from "./errors.ts";

const BOOLEAN = new Set(["json", "help", "private"]);
export interface Parsed {
  words: string[];
  flags: Map<string, string>;
  bools: Set<string>;
}
export function parseArgs(argv: string[]): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "-h") {
      bools.add("help");
      continue;
    }
    if (!arg.startsWith("--")) {
      if (flags.size || bools.size > (bools.has("json") ? 1 : 0)) {
        throw usage(`Unexpected argument ${JSON.stringify(arg)}`);
      }
      words.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOLEAN.has(name)) {
      bools.add(name);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw usage(`--${name} needs a value`);
    }
    i += 1;
    if (flags.has(name)) {
      throw usage(`--${name} given twice`);
    }
    flags.set(name, value);
  }
  return { bools, flags, words };
}
export function allowOnly(parsed: Parsed, names: string[]) {
  for (const name of [...parsed.flags.keys(), ...parsed.bools]) {
    if (!["json", "help", "timezone", ...names].includes(name)) {
      throw usage(`Unknown option --${name} for ${parsed.words.join(" ")}`, `circleback-cli ${parsed.words.join(" ")} --help`);
    }
  }
}
/** A Circleback meeting id: letters, digits, - and _ (e.g. WRweb12iCBimU6Vo8cD7z). */
export function meetingId(parsed: Parsed) {
  const value = parsed.flags.get("id");
  if (value === undefined) {
    throw usage("--id is required", "circleback-cli meetings list");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw usage("--id must be a meeting id from `meetings list` (letters, digits, -, _)", "circleback-cli meetings list");
  }
  return value;
}
export function limit(parsed: Parsed, fallback: number) {
  const raw = parsed.flags.get("limit") ?? String(fallback);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw usage("--limit must be an integer from 1 to 100");
  }
  return n;
}
/** `--since YYYY-MM-DD`, a real calendar date. */
export function since(parsed: Parsed) {
  const raw = parsed.flags.get("since");
  if (raw === undefined) {
    return;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const [y, m, d] = (match ?? []).slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!match || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw usage("--since must be a date YYYY-MM-DD");
  }
  return { d, m, y };
}
/** `--timezone`, else `TZ`, else the system zone: an IANA name every date is shown in. */
export function timezone(parsed: Parsed, env: Record<string, string | undefined>) {
  const zone = parsed.flags.get("timezone") ?? env.TZ?.replace(/^:/, "") ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    throw usage(`--timezone (or TZ) must be an IANA time zone such as America/New_York, not ${JSON.stringify(zone)}`);
  }
}
