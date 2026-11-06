import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let clientPromise: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const root = path.resolve(import.meta.dirname, "../../..");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.join(root, "apps/mcp/src/index.ts")],
    cwd: root,
    env: { ...process.env, MCP_DOCS_ROLE: "EMPLOYEE" } as Record<string, string>,
    stderr: "inherit",
  });
  const client = new Client({ name: "workora-api", version: "0.1.0" });
  transport.onclose = () => {
    clientPromise = null;
  };
  await client.connect(transport);
  return client;
}

export function getMcpClient(): Promise<Client> {
  clientPromise ??= connect().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

export async function listMcpTools() {
  const client = await getMcpClient();
  const { tools } = await client.listTools();
  return tools;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await getMcpClient();
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[] | undefined)
    ?.filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n") ?? "";
  if (res.isError) throw new Error(text || "Tool failed");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
