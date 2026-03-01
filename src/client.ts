import "dotenv/config"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { confirm, input, select } from "@inquirer/prompts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CreateMessageRequestSchema, PromptMessage, Tool } from "@modelcontextprotocol/sdk/types.js"
import { generateText, jsonSchema, ToolSet } from "ai"
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

const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY || "",
})

async function main() {
    await mcp.connect(transport)
    const [tools, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),
        mcp.listPrompts(),
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    mcp.setRequestHandler(CreateMessageRequestSchema, async request => {
        const texts: string[] = []
        for (const message of request.params.messages) {
            // @ts-ignore
            const text = await handleServerMessagePrompts(message)
            if (text != null) texts.push(text)
        }

        return {
            role: "user",
            model: "gemini-2.0-flash",
            stopReason: "endTurn",
            content: {
                type: "text",
                text: texts.join("\n"),
            }
        }
    })

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
            case "Resources":
                const resourceUri = await select({
                    message: "Select a resource",
                    choices: [
                        ...(resources?.map((res: any) => ({
                            name: res.annotations?.title || res.name,
                            value: res.uri,
                            description: res.description,
                        })) || []),
                        ...(resourceTemplates?.map((res: any) => ({
                            name: res.annotations?.title || res.name,
                            value: res.uri,
                            description: res.description,
                        })) || [])
                    ]
                })
                const uri = resources.find((t: any) => t.uri === resourceUri)?.uri || resourceTemplates.find((t: any) => t.uri === resourceUri)?.uriTemplate
                if (uri == null) {
                    console.log("Resource not found")
                    continue
                } else {
                    await handleResource(uri);
                }
            case "Prompts":
                const promptName = await select({
                    message: "Select a prompt",
                    choices: prompts?.map((p: any) => ({
                        name: p.annotations?.title || p.name,
                        value: p.name,
                        description: p.description,
                    })),
                })
                const prompt = prompts.find((p: any) => p.name === promptName)
                if (!prompt) {
                    console.log("Prompt not found")
                    continue
                } else {
                    await handlePrompt(prompt);
                }
            case "Query":
                await handleQuery(tools.tools);
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

async function handleResource(uri: string) {
    let finalUri = uri

    const paramMatches = uri.match(/{([^}]+)}/g)

    if (paramMatches != null) {
        for (const paramMatch of paramMatches) {
            const paramName = paramMatch.replace("{", "").replace("}", "")
            const paramValue = await input({
                message: `Enter value for ${paramName}:`,
            })
            finalUri = finalUri.replace(paramMatch, paramValue)
        }
    }

    const res = await mcp.readResource({
        uri: finalUri,
    })

    console.log("Resource content:", res)
}

async function handlePrompt(prompt: any) {
    const args: Record<string, string> = {}
    for (const arg of prompt.arguments ?? []) {
        args[arg.name] = await input({
            message: `Enter value for ${arg.name}`
        })
    }

    const result = await mcp.getPrompt({
        name: prompt.name,
        arguments: args,
    })

    for await (const message of result.messages) {
        console.log(await handleServerMessagePrompts(message));

    }
}

async function handleServerMessagePrompts(message: PromptMessage) {
    if (message.content.type !== "text") return

    console.log("Message from prompt:", message.content.text)

    const run = await confirm({
        message: "Do you want to run this prompt?",
        default: true,
    })

    if (!run) return;

    const { text } = await generateText({
        model: google("gemini-1.5-flash"),
        prompt: message.content.text,
    })

    return text;
}

async function handleQuery(tools: Tool[]) {
    const query = await input({ message: "Enter your query" })

    const toolSet: ToolSet = tools?.reduce((obj, tool) => ({
        ...obj,
        [tool.name]: {
            description: tool.description,
            inputSchema: jsonSchema(tool.inputSchema), // ✅ must be `inputSchema`, not `parameters`
            execute: async (args: Record<string, any>) => {
                return await mcp.callTool({
                    name: tool.name,
                    arguments: args
                })
            }
        }
    }), {} as ToolSet);

    const { text, toolResults } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: query,
        tools: toolSet
    })

    console.log("Response:", text)

    if (toolResults) {
        console.log("Tool Results:", toolResults)
    }
}

main().catch((error) => {
    console.error("Error:", error)
})