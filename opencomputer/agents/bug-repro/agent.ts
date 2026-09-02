import {
  useInput,
  useModel,
  useTool,
  type AgentInput,
  type DataValue,
} from "@opencomputer/agent";
import { conversation, reproduction, type BugReport } from "./instructions.js";

const GITHUB_URL = /https?:\/\/github\.com\/[\w-]+\/[\w.-]*[\w-]/;

const isObject = (value: DataValue | undefined): value is { readonly [key: string]: DataValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A report arrives as a structured payload (webhook, API) or as text that
// contains a GitHub URL (playground, CLI). Anything else is conversation.
function parse({ text, payload }: AgentInput): BugReport | undefined {
  if (isObject(payload) && typeof payload.repository === "string") {
    return {
      repository: payload.repository,
      path: typeof payload.path === "string" ? payload.path : undefined,
      report: typeof payload.report === "string" ? payload.report : (text ?? ""),
    };
  }
  const repository = text?.match(GITHUB_URL)?.[0];
  return repository && text ? { repository, report: text } : undefined;
}

export default function Agent() {
  const input = useInput();
  const report = parse(input);

  useModel("anthropic/claude-sonnet-4.6");

  if (!report) return conversation(input.text);

  // Harness tools, registered in opencode.json. The names are literals
  // because the compiler reads them to build the deployment's tool registry.
  useTool("shell");
  useTool("read");
  useTool("write");
  useTool("glob");
  useTool("grep");

  return reproduction(report);
}
