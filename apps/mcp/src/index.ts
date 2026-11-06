import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "@workora/core";

const server = new McpServer({ name: "workora", version: "0.1.0" });

for (const tool of tools) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.shape },
    async (args: unknown) => {
      try {
        const result = await tool.run(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );
}

// stdout is reserved for the MCP protocol; log to stderr only.
await server.connect(new StdioServerTransport());
console.error("[workora-mcp] ready with tools:", tools.map((t) => t.name).join(", "));
