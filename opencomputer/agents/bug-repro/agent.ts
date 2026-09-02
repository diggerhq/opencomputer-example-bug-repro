import { useInput, useModel, useTool } from "@opencomputer/agent";
import { conversation, reproduction } from "./instructions.js";

export default function Agent() {
  const input = useInput();
  // The report is the payload's `report` field (webhook, API) or the text
  // itself (playground, CLI). It names the repository by its GitHub URL.
  const payload = (input.payload ?? {}) as { report?: string };
  const report = payload.report ?? input.text ?? "";

  useModel("anthropic/claude-sonnet-4.6");

  if (!report.includes("github.com/")) return conversation(report);

  // Harness tools, registered in opencode.json. The names are literals
  // because the compiler reads them to build the deployment's tool registry.
  useTool("shell");
  useTool("read");
  useTool("write");
  useTool("glob");
  useTool("grep");

  return reproduction(report);
}
