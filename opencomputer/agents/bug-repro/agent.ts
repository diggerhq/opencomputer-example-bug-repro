import { useInput, useModel, useTool } from "@opencomputer/agent";
import { conversation, reproduction, type BugReport } from "./instructions.js";

const GITHUB_URL = /https?:\/\/github\.com\/[\w-]+\/[\w.-]*[\w-]/;

export default function Agent() {
  const input = useInput();
  // A report arrives as a payload (webhook, API) or as text containing a
  // GitHub URL (playground, CLI). Anything else is conversation.
  const payload = (input.payload ?? {}) as Partial<BugReport>;
  const repository = payload.repository ?? input.text?.match(GITHUB_URL)?.[0];

  useModel("anthropic/claude-sonnet-4.6");

  if (!repository) return conversation(input.text);

  // Harness tools, registered in opencode.json. The names are literals
  // because the compiler reads them to build the deployment's tool registry.
  useTool("shell");
  useTool("read");
  useTool("write");
  useTool("glob");
  useTool("grep");

  return reproduction({
    repository,
    path: payload.path,
    report: payload.report ?? input.text ?? "",
  });
}
