# circleback-cli

**Job:** "When an AI agent syncs my Circleback meetings into my store, I want it to list meetings, read notes and transcripts, export each meeting as Markdown and download its recording through one predictable CLI, so that my store gets every meeting the way my manual export had it, without anything changing in Circleback."

## Users

| Who | Uses it to |
| --- | --- |
| An AI agent or script acting for a Circleback user, directly or behind a credential-holding proxy | List meetings since a date, read notes and transcripts, export a meeting as Markdown, download its recording |

Not a user: anyone wanting to edit, share, tag, import or delete meetings, webhooks, search or MCP (owner-approved design, 2026-11-10: read-only sync).

## Never

- **N1** Send a request that is not a GET, or call any Circleback endpoint beyond list meetings, get meeting and get transcript. A deployment that must enforce this puts a credential-holding proxy in front and uses a read-only key (ADR-0001).
- **N2** Print the recording URL or send any credential to the storage host.
- **N3** Commit keys, meetings, transcripts, recordings or meeting-derived fixtures; tests and examples use synthetic identities.
- **N5** Default to one user's settings: the time zone comes from `--timezone`, `TZ` or the system, so the CLI stays publishable (ADR-0003).
- **N4** Report a meeting as exported when its transcript is empty: that is `not_ready`, and no file is written (ADR-0002).

## Contract

- Auth: `CIRCLEBACK_API_KEY` only, sent as a Bearer token to `https://circleback.ai/api`. A proxy may hold the real key and replace a dummy. Proxy from `HTTPS_PROXY`, extra CA from `NODE_EXTRA_CA_CERTS`.
- Paging follows the `Link: rel="next"` header; 429 waits `Retry-After` and retries up to four times.
- Times are in `--timezone`, else `TZ`, else the system zone; `--since` keeps meetings from 00:00 that day in that zone, inclusive.
- Export: `circleback-<id>.md` with `# name`, `**Date**`, `**Duration**`, `**People**`, `**Circleback**`, `## Notes`, `## Action items`, `## Transcript` (`[m:ss] **Speaker**: text`). Recording: `circleback-<id>.<ext>`, streamed, 90 s deadline.
- `--json` output carries `schemaVersion: 1`. Exit 2 usage, 4 key rejected, 5 retry later, 1 otherwise.

## Decisions

Decisions live in `knowledge/`: read-only access (ADR-0001), output files named by meeting id (ADR-0002), the time zone (ADR-0003).

## Changelog

- 2026-11-10: created from the owner-approved design (download the recording too; only new meetings, from 2026-11-07).
- 2026-11-10: owner: keep it publishable as a public repository later; no owner-specific defaults (time zone from `--timezone`/`TZ`/system), README for outside users.
- 2026-11-10: owner: licence AGPL-3.0-or-later, as telegram-cli (`LICENSE` copied verbatim).
- 2026-11-10: owner: publish it; decisions recorded as ADR-0001..0003 in `knowledge/`, history squashed into one root commit.
