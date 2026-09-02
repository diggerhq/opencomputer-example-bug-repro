# Bug reproducer

An OpenComputer Serverless Agent that reproduces bug reports.

Input: a bug report and the URL of a public Git repository. Output: a
failing test written in the repository's own test convention, the test
runner's output, the file and line responsible, and a likely cause.

The agent is one function, `agent.ts`. It defines no tools of its own and
uses no secrets. It selects tools from the managed harness, a coding agent
with a shell and a filesystem that runs in a VM per session. The function
runs before every model step and decides which harness tools the model gets
for that step.

```ts
// opencomputer/agents/bug-repro/agent.ts (trimmed; the file is 90 lines)
import { useInput, useModel, useTool } from "@opencomputer/agent";

export default function Agent() {
  const input = useInput();
  const request = bugReport(input.text, input.payload); // { repository, path, report }

  useModel("anthropic/claude-sonnet-4.6");

  if (!request.repository) {
    return "Your only job is to reproduce bug reports against public Git repositories, and this request names none. Ask for the repository URL and the report text.";
  }

  useTool("shell");
  useTool("read");
  useTool("write");
  useTool("glob");
  useTool("grep");

  return `You reproduce bug reports. You have a shell, a filesystem, and network access for unauthenticated requests.
Repository: ${request.repository}
Report: ${request.report}
Clone with git. Read the existing tests first. Write the smallest failing test in the repository's own convention. Run it. If it passes, try the boundary cases the report implies.
Answer with: Reproduced, Failing test, Observed vs expected, Where, Likely cause. Do not fix the bug.`;
}
```

```json
// opencomputer/agents/bug-repro/opencode.json: harness tools this agent may select
{ "tools": { "shell": true, "read": true, "write": true, "glob": true, "grep": true },
  "permission": { "shell": "allow", "read": "allow", "write": "allow", "external_directory": "allow" } }
```

Each run of the function is recorded as an `agent.rendered` event, with the
selected tools and the instructions hash, before the model is called. The
four runs below are taken from the event log of one deployment.

## 1. A report

```text
$ npx opencomputer session --verbose "Reproduce this bug. Repository: https://github.com/diggerhq/opencomputer-example-bug-repro path fixture. Report: Some invoices are a cent short. Example from accounting: one line at 8.20 with our 7.5% tax rate shows a total of 8.81. Their spreadsheet says 8.82. Most invoices are fine, so it is not every amount."

agent.rendered  providerTurn 1  enabledTools [glob, grep, read, shell, write]
shell           git clone --depth 1 https://github.com/diggerhq/opencomputer-example-bug-repro repo
read            fixture/test/invoice.test.js
read            fixture/src/invoice.js
write           fixture/test/invoice_bug_cent_short.test.js
shell           node --test test/invoice_bug_cent_short.test.js
                not ok 1 - invoiceTotal rounds half-up on .5 tax cent (8.20 @ 7.5% = 8.82)
                8.81 !== 8.82
agent.rendered  providerTurn 8  (same instructions hash as turn 1)

Reproduced: yes
Failing test: fixture/test/invoice_bug_cent_short.test.js
  cd fixture && node --test test/invoice_bug_cent_short.test.js
Observed vs expected:
  8.81 !== 8.82
Where: fixture/src/invoice.js:13
  const tax = round2(subtotal * taxRate);
Likely cause: 8.20 * 0.075 is 0.6149999999999999 in IEEE 754, just below 0.615,
  so Math.round gives 0.61 instead of 0.62 and the total is 8.81.
```

The turn took eight model steps and 55 seconds. The test file remains in
the session's workspace.

## 2. No repository

```text
$ npx opencomputer session --verbose "hi, what do you do?"

agent.rendered  providerTurn 1  enabledTools []

I specialize in reproducing bug reports against public Git repositories. To
get started, please share the repository URL and the bug report text you'd
like me to investigate.
```

Same deployment. The render selected no tools, so the model request
contained none.

## 3. Report 2 through a webhook, delivered twice

```bash
npx opencomputer webhooks create bug-reports --agent bug-repro --environment development
# prints the URL and a bearer token once

curl -X POST 'https://app.opencomputer.dev/api/agent-webhooks/wh_...' \
  -H 'Authorization: Bearer ocwh_...' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: report-2-delivery-1' \
  -d '{"text":"Reproduce report 2.","payload":{
        "repository":"https://github.com/diggerhq/opencomputer-example-bug-repro",
        "path":"fixture",
        "report":"In checkout, previewing a 10% coupon and then closing the preview without applying it leaves the invoice at the discounted price. Reloading does not restore the original amounts."}}'
```

```text
202  { "request": { "sessionId": "5b0420db-…" }, "duplicate": false }
202  { "request": { "sessionId": "5b0420db-…" }, "duplicate": true }    # the same request, sent again

agent.rendered  source webhook  enabledTools [glob, grep, read, shell, write]
shell           git clone …
write           fixture/test/coupon_preview.test.js
shell           not ok 1 - previewing a coupon does not change the original invoice total
                90 !== 100

Reproduced: yes
Where: fixture/src/invoice.js:21
Likely cause: withCoupon shallow-copies the invoice ({ ...invoice }); lines is
  the same array, and forEach mutates each line's unitPrice in place.
```

The payload names the repository, so the function selects the same tools as
in run 1. A second delivery with the same `Idempotency-Key` returns the
original session instead of starting another one.

## 4. A follow-up in session 1 after it suspended

```text
$ npx opencomputer session send 56d3d45e-… --verbose "Same repository: https://github.com/diggerhq/opencomputer-example-bug-repro path fixture. Follow-up: does lineTotal have the same rounding problem for unitPrice 2.675 and quantity 1? Reuse the existing clone if present."

Resuming 56d3d45e-…            # session status was suspended
Reusing the existing clone at /tmp/opencode/repo — no re-clone needed.
write           fixture/test/linetotal_bug_rounding.test.js
shell           ok 1 - lineTotal rounds half-up: unitPrice 2.675 × 1 = 2.68

Reproduced: no
Likely cause: 2.675 is stored just below 2.675, but 2.675 * 100 lands exactly on
  267.5 in IEEE 754; the two rounding errors cancel and Math.round rounds up.
```

The workspace and the conversation persist with the session across suspend
and resume.

The function reads the input of the current turn only, not the
conversation. A follow-up that omits the repository URL renders as in run 2
and gets no tools for that turn, whether or not a clone exists. Include the
repository in each request, as the webhook payload does, or read it from
session data with `useSessionData()`; there is no public API to write
session data yet.

## Run

Requires Node 22 and an OpenComputer account.

```bash
git clone https://github.com/diggerhq/opencomputer-example-bug-repro.git
cd opencomputer-example-bug-repro
npm install
npx opencomputer login
npx opencomputer deploy --watch --create-project bug-repro
```

`deploy --watch` builds the agent, creates the project, deploys to
`development`, and redeploys on each save. Run the four scenarios from a
second terminal. For run 4, take the session id from
`npx opencomputer session list`.

To use another repository, put its URL and the report in the session text,
or send them as `payload.repository`, `payload.path`, and `payload.report`.

## Inspect a session

```bash
npx opencomputer sessions tail <session-id> --after 0 --no-follow --json
```

This prints the session's event log as NDJSON. `agent.rendered` carries
`enabledTools`, the instructions hash, the deployment id, the provider turn,
and the state version. `tool.completed` carries the shell output.
`session.status_changed` records `suspending` and `suspended` about one
second after a turn ends. The dashboard's session inspector shows the same
records with the full instructions.

After a build,
`opencomputer/agents/bug-repro/.opencomputer/runtime/.opencomputer/reactive.json`
contains what the compiler extracted from the source, including the tool
list that every render is checked against.

## Files

```text
opencomputer/project.ts                  lists the project's agents
opencomputer/agents/bug-repro/agent.ts   the function
opencomputer/agents/bug-repro/opencode.json
fixture/src/invoice.js                   a billing module with two bugs
fixture/test/invoice.test.js             the existing suite; passes with both bugs present
fixture/BUG-REPORTS.md                   the two reports
DX-NOTES.md                              observations from building this against the live platform
```

## Limits

- Public repositories only; the clone is unauthenticated. Credentials are
  declared as connections with the secret attached outside the VM; see the
  [Pull Request Reviewer](https://github.com/diggerhq/opencomputer-example-pr-review).
- The repository's own scripts run inside the session VM. Treat the target
  repository as untrusted code. "Do not modify existing files" is an
  instruction to the model, not an enforced boundary. The VM holds no
  credentials.
- Not used here: subagents, skills, MCP servers.

Docs: [How it works](https://docs.opencomputer.dev/agents/mental-model) ·
[Reactive agents](https://docs.opencomputer.dev/agents/reactive-agents) ·
[Inputs](https://docs.opencomputer.dev/agents/inputs) ·
[Webhooks](https://docs.opencomputer.dev/agents/webhooks) ·
[Sessions](https://docs.opencomputer.dev/agents/sessions)

MIT.
