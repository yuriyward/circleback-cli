---
id: ADR-0002
type: decision
status: accepted
domain: system
title: Output files are named by meeting id
# area.name, e.g. dispatch.queue. One accepted decision per key; replacing one needs `supersedes`.
decision_key: export.naming
code_paths:
  - src/commands.ts
  - src/format.ts
supersedes: []
superseded_by: null
---

# ADR-0002 — Output files are named by meeting id

## Question

How are exported meetings and recordings named and written, so a repeated sync finds what it already has?

## Outcome

By meeting id: `circleback-<id>.md` for the Markdown export and `circleback-<id>.<ext>` for the recording, each written beside its final name and then renamed, so a file under the final name is always complete. A meeting whose transcript is still empty is `not_ready` (exit 5) and writes nothing; the recording is a separate command, so a failed or oversized recording never loses the meeting text.

## Alternatives

| Alternative | Why it lost |
| --- | --- |
| Name by date and meeting title | Titles change and collide; an id is stable across runs |
| Write the recording inside `meetings export` | A slow or oversized recording would fail the text export too |

## Premises

- The caller syncs only new meetings and checks for existing files by name.
- Transcripts appear some time after a meeting ends.

## Revisit if

- Circleback ids stop being stable, or a user needs human-readable names (a caller can rename).

## Evidence

- measured: `src/__tests__/cli.test.ts` "meetings export writes circleback-<id>.md in the manual-export shape", "an empty transcript is not_ready (exit 5) and writes nothing" and "an oversized or slow recording fails retryably and leaves no file".
