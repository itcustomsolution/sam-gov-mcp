#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
if (!process.env.SAM_API_KEY) console.error("sam-gov-mcp: SAM_API_KEY is not set; search tools will return an error until it is.");
