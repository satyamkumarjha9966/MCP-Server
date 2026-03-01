import { input, select } from "@inquirer/prompts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Tool } from "@modelcontextprotocol/sdk/types.js"
import { promise } from "zod/v4"

const mcp = new Client(
    {
        name: "text-client-video",
        version: "1.0.0",
    },
    { capabilities: { sampling: {} } }
)

const transport = new StdioClientTransport({
    command: "node",
    args: ["build/server.js"],
    stderr: "ignore",
})

async function main() {
    await mcp.connect(transport)
    const [tools, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),
        mcp.listPrompts(),
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    console.log("You Are Connected Succcessfully");

    while (true) {
        const option = await select({
            message: "What would you like to do",
            choices: ["Query", "Tools", "Resources", "Prompts"]
        })

        switch (option) {
            case "Tools":
                const toolName = await select({
                    message: "Select a tool",
                    choices: tools?.tools?.map((tool: any) => ({
                        name: tool.annotations?.title || tool.name,
                        value: tool.name,
                        description: tool.description,
                    })),
                })
                const tool = tools.tools.find((t: any) => t.name === toolName)
                if (!tool) {
                    console.log("Tool not found")
                    continue
                } else {
                    await handleTool(tool);
                }
        }
    }

}

async function handleTool(tool: Tool) {
    const args: Record<string, string> = {}
    for (const [key, value] of Object.entries(tool.inputSchema.properties ?? {})) {
        args[key] = await input({
            message: `Enter value for ${key} (${(value as any).type})`
        })
    }

    const result = await mcp.callTool({
        name: tool.name,
        arguments: args,
    })
    console.log("Tool result:", result)
}

main().catch((error) => {
    console.error("Error:", error)
})