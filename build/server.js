import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve data path: when running from build/server.js, data is at src/data/; when from src/server.ts, at data/
const projectRoot = path.resolve(__dirname, "..");
const userDataPath = path.join(projectRoot, "src", "data", "user.json");
const server = new McpServer({
    name: "learn-mcp",
    version: "1.0.0",
    description: "A simple MCP server that learns from the user",
}, {
    capabilities: {
        resources: {},
        tools: {},
        prompts: {},
    },
});
// name, description, inputSchema, Annotation (optional), outputSchema
server.registerTool("create-user", {
    description: "Create a new user in Database",
    inputSchema: {
        name: z.string(),
        email: z.string().email(),
        password: z.string(),
    },
    annotations: {
        title: "Create User",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
}, async (args) => {
    try {
        const id = await createUser(args);
        return { content: [{ type: "text", text: `Created user: ${id}` }] };
    }
    catch (error) {
        return { content: [{ type: "text", text: `Failed to create user: ${error}` }] };
    }
});
// registerResource: use ResourceTemplate with list() so the resource appears in templates list (some clients only show templates).
// Static URI resources only appear in resources/list; templates appear in resources/templates/list — so "users" is discoverable.
server.registerResource("users", new ResourceTemplate("users://all", {
    list: async () => ({
        resources: [{ uri: "users://all", name: "users", description: "All users in the database", mimeType: "application/json" }],
    }),
}), {
    description: "All users in the database",
    title: "All Users",
    mimeType: "application/json",
}, async (uri, _variables) => {
    const raw = await fs.readFile(userDataPath, "utf-8");
    const users = JSON.parse(raw);
    return {
        contents: [
            {
                uri: uri.href,
                text: JSON.stringify(users),
                mimeType: "application/json",
            },
        ],
    };
});
server.registerResource("get-user", new ResourceTemplate("users://{id}/profile", {
    // Cursor only uses resources/list (not templates/list), so we must list at least 1 URI for it to show.
    // We list one example (users://1/profile); the read handler supports any id: users://5/profile, etc.
    list: async () => {
        try {
            const raw = await fs.readFile(userDataPath, "utf-8");
            const users = JSON.parse(raw);
            const firstId = users[0]?.id ?? 1;
            return {
                resources: [{
                        uri: `users://${firstId}/profile`,
                        name: "get-user",
                        description: `Get user by ID. Use users://{id}/profile (e.g. users://${firstId}/profile, users://5/profile)`,
                        mimeType: "application/json",
                    }],
            };
        }
        catch {
            return { resources: [] };
        }
    },
}), {
    description: "Get user details by ID. Use users://{id}/profile with desired id",
    title: "Get User by ID",
    mimeType: "application/json",
}, async (uri, variables) => {
    const raw = await fs.readFile(userDataPath, "utf-8");
    const users = JSON.parse(raw);
    const user = users.find(u => u.id === Number(variables.id));
    if (!user) {
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify({ error: "User not found" }),
                    mimeType: "application/json",
                },
            ],
        };
    }
    return {
        contents: [
            {
                uri: uri.href,
                text: JSON.stringify(user),
                mimeType: "application/json",
            },
        ],
    };
});
// registerPrompt(name, config, callback) — config must include argsSchema; callback receives parsed args
server.registerPrompt("generate-fake-user", {
    description: "Generate a fake user profile by name",
    argsSchema: { name: z.string() },
}, ({ name }) => {
    return {
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Generate a fake user profile with the name "${name}". The profile should include name, email, and password.`,
                },
            },
        ],
    };
});
const SamplingResponseSchema = z.any();
// Sampling Example - Basically use for all the AI to get some response 
server.registerTool('create-random-user', {
    description: 'Create a random user using fake data from the sampling API',
    annotations: {
        title: "Create User",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
}, async () => {
    // 1) Ask the model to generate a JSON-only user profile.
    let response;
    try {
        response = await server.server.request({
            method: "sampling/createMessage",
            params: {
                model: "gpt-4o", // REQUIRED
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: "Generate a fake user profile with the name 'John Doe'. The profile should include name, email, and password. Return only the profile in JSON format.",
                        },
                    },
                ],
                maxTokens: 1024,
            },
        }, SamplingResponseSchema);
    }
    catch (err) {
        return { content: [{ type: "text", text: `Model call failed: ${String(err)}` }] };
    }
    // 2) Validate we got text back from the model.
    const modelText = response.content[0]?.text;
    if (typeof modelText !== "string") {
        return { content: [{ type: "text", text: `${'Failed to generate fake user profile (no text returned)' + modelText + JSON.stringify(response)}` }] };
    }
    // 3) Clean common code fences and surrounding markdown. Models sometimes wrap
    //    JSON in triple-backtick fences (```json ... ```). Remove them before parsing.
    const cleaned = modelText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    // 4) Parse JSON and validate required fields. Return helpful errors if parsing
    //    or validation fails so callers know what went wrong.
    let fakeUser;
    try {
        fakeUser = JSON.parse(cleaned);
    }
    catch (err) {
        return { content: [{ type: "text", text: `Failed to parse model output as JSON: ${String(err)}` }] };
    }
    if (!fakeUser || typeof fakeUser.name !== "string" || typeof fakeUser.email !== "string" || typeof fakeUser.password !== "string") {
        return { content: [{ type: "text", text: "Model output is missing required fields: name, email, password" }] };
    }
    // 5) Persist the user and return success or a persistence error.
    try {
        const id = await createUser(fakeUser);
        return { content: [{ type: "text", text: `User ${id} created successfully` }] };
    }
    catch (err) {
        return { content: [{ type: "text", text: `Failed to create user: ${String(err)}` }] };
    }
});
async function createUser(user) {
    const raw = await fs.readFile(userDataPath, "utf-8");
    const users = JSON.parse(raw);
    const id = users.length + 1;
    users.push({
        id,
        name: user.name,
        email: user.email,
        password: user.password,
    });
    await fs.writeFile(userDataPath, JSON.stringify(users, null, 2));
    return id;
}
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("Server is running on port 3000");
}
main();
