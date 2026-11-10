---
id: ADR-0001
type: decision
status: accepted
domain: system
title: Read-only access: GET requests to three endpoints
# area.name, e.g. dispatch.queue. One accepted decision per key; replacing one needs `supersedes`.
decision_key: api.read-only
code_paths:
  - src/api.ts
  - src/commands.ts
supersedes: []
superseded_by: null
---

# ADR-0001 — Read-only access: GET requests to three endpoints

## Question

What may the CLI do in the user's Circleback account?

## Outcome

Read only. Every request is a GET to one of three endpoints, `/api/meetings`, `/api/meeting/<id>` and `/api/meeting/<id>/transcript`, plus the `recordingUrl` a meeting returns, fetched without credentials and without following redirects. No command edits, shares, tags, imports or deletes anything. A deployment that must enforce this puts a credential-holding proxy in front that allows exactly these requests and uses a read-only key; a new endpoint is a contract change for such deployments.

## Alternatives

| Alternative | Why it lost |
| --- | --- |
| Full API coverage (edits, tags, webhooks, search) | The job is a sync into a store; writes add risk and no user needs them |
| Circleback's MCP server | Exposes more than read access, and an agent cannot be held to a subset |

## Premises

- The key can read every meeting of the account; a write mistake would change the user's own records.
- The recording URL is a signed bearer link, so it is never printed and never receives the API key.

## Revisit if

- A user needs to change something in Circleback through an agent.

## Evidence

- measured: `src/__tests__/cli.test.ts` "429 waits Retry-After and retries; only GETs with the key are ever sent" and "recordings download streams the signed URL with no Authorization and never prints it".
- reported: owner-approved design, 2026-11-10: read-only sync of meetings, transcripts and recordings.
