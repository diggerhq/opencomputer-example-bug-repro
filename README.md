# Bug reproducer

An agent that takes a bug report and a public repository, clones the code,
writes the smallest failing test, runs it, and answers with the failing
assertion, the file and line, and the cause. Built on OpenComputer Serverless
Agents. No custom tools, no credentials, one function.

This README is a walkthrough of one design decision in Serverless Agents:
every agent runs inside a complete coding agent in its own virtual machine.
The reproducer exists to show what that decision makes possible.

## The problem

A bug report arrives as prose:

> Some invoices are a cent short. Example from accounting: one line at 8.20
> with our 7.5% tax rate shows a total of 8.81. Their spreadsheet says 8.82.
> Most invoices are fine, so it is not every amount.

The first question in triage is not "what is the fix". It is "does this
reproduce, and where". Answering it means getting the code, reading how it
is tested, writing a case that exercises the claim, running it, and, when
the first case passes, trying the boundaries the report implies until one
fails. The output people want is a failing test and its output, not an
opinion.

## Why a tool-calling agent cannot do this

The usual agent is a model in a loop with a fixed list of declared tools:
`read_file`, `search_code`, maybe `fetch_url`. Given this report and those
tools, it can read `invoice.js` and produce a hypothesis. It cannot clone a
repository, install anything, write a test file, or run a test runner,
because nothing it was given does those things. The hypothesis may be
right. It is still a hypothesis, and the reader has to do the reproduction
themselves to find out.

You can add a `run_code` tool backed by a sandbox service. Then you own the
integration: a filesystem that persists between calls, file editing that the
model can use reliably, output streaming, a workspace that survives the
session going idle, and the safety rules for all of it. What you have built
at that point is a coding-agent harness.

## What Serverless Agents does instead

OpenComputer runs every agent inside a complete coding agent, the OpenCode
engine, in a MicroVM with its own filesystem. The engine supplies, as engine
features rather than as tools you write:

- a workspace with `shell`, `read`, `write`, `glob`, and `grep`;
- skills loaded on demand from `SKILL.md` files;
- subagents as child sessions;
- context compaction for long sessions;
- a permission and question flow;
- queue, steer, and interrupt semantics for new input during a turn;
- a provider-agnostic model layer.

The MicroVM suspends when the session goes idle and resumes with the
conversation and the workspace intact.

Your code does not run that loop. Your code is a function that runs before
every model step and decides what the model gets for that step: the
instructions, the model, and which of the engine's capabilities are in the
request. The engine's tools exist, but none is offered unless the function
selects it. A request that does not need a shell does not get one.

## The agent

The whole agent is one file plus one JSON file.

`opencomputer/agents/bug-repro/agent.ts`:

```ts
import { useInput, useModel, useTool } from "@opencomputer/agent";

export default function Agent() {
  const input = useInput();
  const request = bugReport(input.text, input.payload); // repository, path, report

  useModel("anthropic/claude-sonnet-4.6");

  // No repository named: a conversation. The model gets no tools at all.
  if (!request.repository) {
    return "Your only job is to reproduce bug reports against public Git repositories, and this request names none. Ask for the repository URL and the report text.";
  }

  // A repository is named: attach the computer.
  useTool("shell");
  useTool("read");
  useTool("write");
  useTool("glob");
  useTool("grep");

  return `You reproduce bug reports. You have a shell, a filesystem, and network access for unauthenticated requests.
Repository: ${request.repository}
Report: ${request.report}
Workflow: clone with git; read the existing tests first; write the smallest failing test in the repository's own convention; run it; if it passes, try the boundary cases the report implies; answer with Reproduced, Failing test, Observed vs expected, Where, Likely cause. Do not fix the bug.`;
}
```

The real file has the full instructions and a `bugReport()` helper that
reads either a structured payload (`{ repository, path, report }`) or a
GitHub URL inside plain text. Nothing else.

`opencomputer/agents/bug-repro/opencode.json` registers which engine tools
this agent's deployment may use at all:

```json
{
  "tools": { "shell": true, "read": true, "write": true, "glob": true, "grep": true },
  "permission": { "shell": "allow", "read": "allow", "write": "allow", "external_directory": "allow" }
}
```

Two levels, on purpose. The deployment registers the complete set of tools
that can ever exist for this agent. The function selects a subset for each
model step. A tool that is not registered cannot be selected; a tool that
is not selected is not in the request.

## "Reactive" in practice

The function is called before every model step, with the input that started
the turn and a snapshot of session state. Its return value and its `useTool`
calls are recorded before the model is called. The record is visible in the
session's event stream as `agent.rendered`.

Two requests, two records, same deployment. A greeting:

```json
{ "providerTurn": 1, "enabledTools": [], "input": { "source": "user", "text": "hi, what do you do?" } }
```

The model answered with two sentences asking for a repository and a report.
It had no tools to answer with anything else.

Report 1:

```json
{ "providerTurn": 1, "enabledTools": ["glob", "grep", "read", "shell", "write"],
  "input": { "source": "user", "text": "Reproduce this bug. Repository: https://github.com/diggerhq/opencomputer-example-bug-repro path fixture. Report: Some invoices are a cent short. ..." } }
```

That turn took eight model steps, so the function ran eight times, and all
eight records carry the same instructions hash. Between steps the engine ran
the tools the model asked for:

```text
shell   git clone --depth 1 https://github.com/diggerhq/opencomputer-example-bug-repro repo
read    fixture/test/invoice.test.js, fixture/src/invoice.js
write   fixture/test/invoice_bug_cent_short.test.js
shell   node --test test/invoice_bug_cent_short.test.js
        not ok 1 - invoiceTotal rounds half-up on .5 tax cent (8.20 @ 7.5% = 8.82)
        8.81 !== 8.82
```

The answer, verbatim from the session, trimmed:

```text
Reproduced: yes
Failing test: fixture/test/invoice_bug_cent_short.test.js
  cd fixture && node --test test/invoice_bug_cent_short.test.js
Observed vs expected:
  not ok 1 - invoiceTotal rounds half-up on .5 tax cent (8.20 @ 7.5% = 8.82)
  8.81 !== 8.82
Where: fixture/src/invoice.js:13
  const tax = round2(subtotal * taxRate);
Likely cause: 8.20 * 0.075 is 0.6149999999999999 in IEEE 754, just below
  0.615, so Math.round gives 0.61 instead of 0.62 and the total is 8.81.
```

One turn, under a minute, and the test file is sitting in the workspace.

### The capability follows the input, not the session

The function sees the input that started the current turn. It does not see
the conversation. A follow-up in the same session that does not name the
repository renders the conversational branch, and the model gets no tools
for that turn even though the clone is still on disk. This is not a bug in
the platform; it is what "a function of the current input" means. Two ways
to handle it:

- name the repository in every request (a webhook payload does this for
  free; a person can paste the URL again);
- read it from session data with `useSessionData()`, which persists across
  renders. There is no public API to write session data yet, so this example
  uses the first.

With the URL included, the follow-up rendered the shell set again, and the
model said "Reusing the existing clone at /tmp/opencode/repo, no re-clone
needed", wrote a second test, ran it, and reported "Reproduced: no" with the
reason: for 2.675 the two floating-point errors cancel. The session had been
suspended between the two turns; the workspace came back with it.

## Run it

Prerequisites: Node 22, an OpenComputer account.

```bash
git clone https://github.com/diggerhq/opencomputer-example-bug-repro.git
cd opencomputer-example-bug-repro
npm install
npx opencomputer login
npx opencomputer deploy --watch --create-project bug-repro
```

`deploy --watch` builds the agent, creates the project, publishes the first
deployment to `development`, prints the dashboard URL, and redeploys on every
save. There is no local agent server; the agent runs in OpenComputer's
development cloud. Leave it running and use a second terminal.

Send Report 1:

```bash
npx opencomputer session --verbose "Reproduce this bug. Repository: https://github.com/diggerhq/opencomputer-example-bug-repro path fixture. Report: Some invoices are a cent short. Example from accounting: one line at 8.20 with our 7.5% tax rate shows a total of 8.81. Their spreadsheet says 8.82. Most invoices are fine, so it is not every amount."
```

`--verbose` prints every event: the render record, each `tool.started` and
`tool.completed`, and the model's text. Without it you get the text.

Send a greeting and compare the render record:

```bash
npx opencomputer session --verbose "hi, what do you do?"
```

### Report 2, through a webhook

Webhooks are how an issue tracker would deliver reports. They are
operational resources, created outside the code:

```bash
npx opencomputer webhooks create bug-reports --agent bug-repro --environment development
```

The command prints the URL and a bearer token once. Post the second report
as a structured payload:

```bash
curl -X POST 'https://app.opencomputer.dev/api/agent-webhooks/wh_...' \
  -H 'Authorization: Bearer ocwh_...' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: report-2-delivery-1' \
  -d '{
    "text": "Reproduce report 2.",
    "payload": {
      "repository": "https://github.com/diggerhq/opencomputer-example-bug-repro",
      "path": "fixture",
      "report": "In checkout, previewing a 10% coupon and then closing the preview without applying it leaves the invoice at the discounted price. Reloading does not restore the original amounts."
    }
  }'
```

The response is `202` with a session URL. Run the same command again with
the same `Idempotency-Key` and you get the same session and
`"duplicate": true`; a retrying upstream does not start a second
reproduction. The render record for that session shows
`"source": "webhook"` and the same five tools.

Report 2 reproduces at `fixture/src/invoice.js:21`: `withCoupon` shallow-
copies the invoice and mutates the shared line objects, so the original
total changes from 100 to 90 after a preview.

### Follow up in the same session

Sessions are durable. Take the session id from the first run (`npx
opencomputer session list`) and send a follow-up that names the repository:

```bash
npx opencomputer session send <session-id> --verbose "Same repository: https://github.com/diggerhq/opencomputer-example-bug-repro path fixture. Follow-up: does lineTotal have the same rounding problem for unitPrice 2.675 and quantity 1? Reuse the existing clone if present."
```

The session resumes from suspended; the clone is still there.

## What to look at

- `npx opencomputer sessions tail <session-id> --after 0 --no-follow --json`
  prints the durable event log as NDJSON. Filter for `agent.rendered` to see
  `enabledTools` per model step, `tool.completed` for the shell output, and
  `session.status_changed` for `suspending` and `suspended`.
- The dashboard's session inspector shows the same render records with the
  full instructions.
- `opencomputer/agents/bug-repro/.opencomputer/runtime/.opencomputer/reactive.json`
  after a build: what the compiler extracted from the source, including the
  tool list the render is validated against.

## What this example does not show

- **Credentials.** The reproducer works on public repositories with
  unauthenticated `git clone`. Private repositories and write access go
  through declared connections with secrets attached outside the runtime;
  see the [Pull Request Reviewer](https://github.com/diggerhq/opencomputer-example-pr-review)
  example.
- **Subagents, skills, compaction.** Engine features this agent does not
  select.
- **Safety.** The repository's own test scripts run inside the session's
  virtual machine, so treat the code you point the agent at as untrusted.
  The instructions tell the model not to modify existing files; that is a
  behavioral rule, not an enforced boundary. The VM holds no credentials,
  which is the boundary that matters.

## Anatomy

```text
opencomputer/
  project.ts                       lists the project's agents
  agents/bug-repro/
    agent.ts                       the function: input → instructions + tools
    opencode.json                  engine tools this agent may select
fixture/
  src/invoice.js                   a billing module with two real bugs
  test/invoice.test.js             the existing suite; passes with both bugs
  BUG-REPORTS.md                   the two reports, as they arrive
DX-NOTES.md                        what was observed building this against the live platform
```

## Docs

- [Serverless Agents overview](https://docs.opencomputer.dev/agents/overview)
- [How it works](https://docs.opencomputer.dev/agents/mental-model)
- [Reactive agents](https://docs.opencomputer.dev/agents/reactive-agents)
- [Inputs](https://docs.opencomputer.dev/agents/inputs)
- [Webhooks](https://docs.opencomputer.dev/agents/webhooks)
- [Sessions and turns](https://docs.opencomputer.dev/agents/sessions)

MIT licensed.
