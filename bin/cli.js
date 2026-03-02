#!/usr/bin/env node
import("../build/server.js").then(({main}) => main()).catch((error) => {
    console.error("MCP Server Failed to Start : Error > ", error);
    process.exit(1);
});