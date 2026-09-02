# DX notes

Observations while building this example against the live platform
(CLI 0.6.6, agent 0.5.2, 2026-09-02), in order.

## 001 — base coding-agent identity shows through a no-tools render (gap)

First version of the conversational branch returned "Ask for the repository
URL and the report text." The render record showed `enabledTools: []`, but
the model replied "I'm OpenComputer, an AI coding agent. I can help you with
Debugging, Adding features, Refactoring…". The engine's base prompt sits
under the rendered instructions and wins when ours are short. Rewording to
"Your only job is… You have no tools in this step. Reply in two sentences…
Do not list general coding abilities" fixed it. A non-coding agent needs to
say explicitly what it is not.

## 002 — a follow-up without the URL rendered no tools and an empty reply (by design, then odd)

Second turn in the same session, text without a GitHub URL: the render took
the conversational branch (`enabledTools: []`), as written. The turn then
completed with `message.completed` `"text": ""` and the CLI printed nothing
after "Resuming…". The empty completion is the odd part; expected the model
to ask for the URL as instructed. Not reproduced after the 001 rewording;
noting it.

## 003 — `webhooks create --json` printed nothing on stdout (bug)

`npx opencomputer webhooks create <name> --agent … --environment … --json`
produced no stdout, so a script could not read the URL or token. Without
`--json` the command prints both once. `webhooks list --json` works.

## 004 — docs name the shell tool `bash`; the engine registers `shell` (docs bug)

`docs/agents/examples/test-coverage.mdx` says the example "registers the
runtime-provided `bash` and `read` tools"; the example's `opencode.json` and
its `useTool` calls use `shell`. `shell` is what works.

## 005 — what worked first time (nice)

`git`, `node` 22 with `node --test`, and unauthenticated network are present
in the VM; `git clone` of a public repository succeeded on the first shell
call. One turn = eight `agent.rendered` events with the same instructions
hash, one per model step, visible in `session --verbose` and `sessions tail
--json`. The session suspended about a second after the turn; a later turn
resumed it (runtime epoch 2) and the clone at `/tmp/opencode/repo` was still
there. Webhook delivery with a repeated `Idempotency-Key` returned the same
session with `"duplicate": true`.
