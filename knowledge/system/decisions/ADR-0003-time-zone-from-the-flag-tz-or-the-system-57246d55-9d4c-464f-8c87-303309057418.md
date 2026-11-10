---
id: ADR-0003
type: decision
status: accepted
domain: system
title: Time zone from the flag, TZ or the system
# area.name, e.g. dispatch.queue. One accepted decision per key; replacing one needs `supersedes`.
decision_key: time.zone
code_paths:
  - src/args.ts
  - src/format.ts
supersedes: []
superseded_by: null
---

# ADR-0003 — Time zone from the flag, TZ or the system

## Question

Which time zone decides displayed times and the `--since` cutoff?

## Outcome

`--timezone`, else `TZ`, else the system zone. `--since` keeps meetings from 00:00 that day in that zone, inclusive. There is no built-in default for any one user, so the CLI works the same for anyone who installs it.

## Alternatives

| Alternative | Why it lost |
| --- | --- |
| A fixed default zone | Correct for one user only, and wrong silently for everyone else |
| Always UTC | Day boundaries would cut a local day in two |

## Premises

- The repository is meant to be publishable; no user-specific setting lives in the code.

## Revisit if

- Circleback returns a per-account time zone the CLI could use instead.

## Evidence

- measured: `src/__tests__/cli.test.ts` "--timezone overrides TZ for dates and the --since cutoff; an unknown zone is a usage error".
- reported: owner, 2026-11-10: keep it publishable, no owner-specific defaults.
