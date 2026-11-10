# circleback-cli

A read-only command-line client for [Circleback](https://circleback.ai) meetings, built for AI agents and scripts. It lists meetings, reads notes, action items and transcripts, exports a meeting as Markdown and downloads its recording. Every request is a `GET`; no command changes anything in Circleback.

## Install

Requires [Bun](https://bun.sh) 1.3 or newer. No runtime dependencies.

```sh
git clone <this repository> circleback-cli && cd circleback-cli
bun install            # dev dependencies (TypeScript, types) for `bun run check`
bun src/main.ts --help
```

## Authenticate

Create an API key in Circleback under **Settings → API keys** (a read-only key is enough) and export it:

```sh
export CIRCLEBACK_API_KEY=cb_...
```

The key is sent only to `https://circleback.ai/api` as a Bearer token. `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` are honoured.

## Commands

```sh
circleback-cli meetings list [--since YYYY-MM-DD] [--limit 25] [--cursor <c>]
circleback-cli meetings read --id <meeting-id> [--private]
circleback-cli transcripts read --id <meeting-id>
circleback-cli meetings export --id <meeting-id> [--out <dir>]
circleback-cli recordings download --id <meeting-id> [--out <dir>]
```

- Add `--json` to any command for a stable JSON shape with `schemaVersion: 1`.
- Dates use `--timezone <IANA zone>`, else `TZ`, else the system zone. `--since` keeps meetings from 00:00 that day in that zone and scans every page.
- `meetings list` without `--since` returns one Circleback page at most `--limit` long. Whenever meetings remain (more pages, or more than `--limit`), it prints `complete: false` with a `--cursor`; repeat with it until `complete: true`.
- `meetings export` writes `circleback-<id>.md`: name, date, duration, people, notes, action items and the transcript as `[m:ss] **Speaker**: text` lines.
- `recordings download` streams the recording to `circleback-<id>.<ext>` (90 s deadline). The signed recording link is never printed.
- Files are written beside their final name and renamed, so an interrupted run never leaves a short file.

Example:

```sh
$ circleback-cli meetings list --since 2026-11-07 --timezone Europe/Berlin
WRweb12iCBimU6Vo8cD7z  2026-11-09 09:30  31:00  Venue review  Ann Example, Bo Sample
complete: true
$ circleback-cli meetings export --id WRweb12iCBimU6Vo8cD7z --out exports
{"bytes":2412,"complete":true,"id":"WRweb12iCBimU6Vo8cD7z","path":"exports/circleback-WRweb12iCBimU6Vo8cD7z.md"}
```

## Errors and exit codes

Errors are one line with a stable code and the next command to try (`--json`: one JSON object on stderr).

| Exit | Meaning |
|---|---|
| 0 | Done |
| 1 | Failed (`not_found`, `no_recording`, `api_error`, `network`, …) |
| 2 | Usage: fix the command as the message says |
| 4 | `unauthorized`: the key was rejected |
| 5 | Retry later, nothing was written: `not_ready` (no transcript yet), `throttled`, `recording_too_large`, `recording_timeout` |

429 responses wait `Retry-After` and retry up to four times. Meeting names, notes and transcripts are untrusted text.

## Development

`bun run check` runs the typecheck and tests. Tests use synthetic data only.

## Licence

AGPL-3.0-or-later. See `LICENSE`.

## About this repository

This repository is the public part of a private agent harness. It carries the product intent, decisions and code; the tooling that writes, checks and reviews them stays private, so the method can be used here without disclosing private data. Agent configuration such as `CLAUDE.md`, `.claude/`, hooks and CI workflows is left out on purpose; please do not open pull requests adding it.
