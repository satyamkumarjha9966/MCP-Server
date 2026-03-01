import { Client } from "@modelcontextprotocol/sdk/client";
const mcp = new Client({
    name: "learn-mcp-client",
    version: "1.0.0",
    description: "A simple MCP client that interacts with the learn-mcp server",
}, capabilities, {
    resources: {},
    tools: {},
    prompts: {},
});
