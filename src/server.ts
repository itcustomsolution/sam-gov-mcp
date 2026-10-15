import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SamGovClient, SET_ASIDE_CODES, FetchLike } from "./samgov.js";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ ...text(`Error: ${(e as Error).message}`), isError: true });

export function createServer(opts: { apiKey?: string; fetchImpl?: FetchLike; baseUrl?: string } = {}) {
  const server = new McpServer({ name: "sam-gov-mcp", version: "0.1.0" });
  const client = () => new SamGovClient(opts.apiKey ?? process.env.SAM_API_KEY ?? "", opts.fetchImpl, opts.baseUrl);

  server.registerTool(
    "search_opportunities",
    {
      title: "Search SAM.gov opportunities",
      description: "Search SAM.gov contract opportunities. Read-only. Posted date range is required (max 1 year).",
      inputSchema: {
        keywords: z.string().optional().describe("Words to match in the opportunity title"),
        naics: z.string().optional().describe("NAICS code, e.g. 541512"),
        set_aside: z.string().optional().describe("Set-aside code, e.g. SBA, 8A, SDVOSBC (see list_set_aside_codes)"),
        posted_from: z.string().optional().describe("Start date, YYYY-MM-DD or MM/DD/YYYY (default: 30 days ago)"),
        posted_to: z.string().optional().describe("End date, YYYY-MM-DD or MM/DD/YYYY (default: today)"),
        state: z.string().optional().describe("Place of performance state, 2-letter code"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 10)"),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (a) => {
      try {
        return text(await client().search({
          keywords: a.keywords, naics: a.naics, setAside: a.set_aside, postedFrom: a.posted_from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          postedTo: a.posted_to ?? new Date().toISOString().slice(0, 10), state: a.state, limit: a.limit, offset: a.offset,
        }));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "get_opportunity",
    {
      title: "Get SAM.gov opportunity",
      description: "Get full details of one opportunity by noticeId (searches the last year of postings).",
      inputSchema: { notice_id: z.string().describe("SAM.gov noticeId") },
    },
    async (a) => {
      try {
        const o = await client().getOpportunity(a.notice_id);
        return o ? text(o) : fail(new Error(`No opportunity found for noticeId ${a.notice_id}`));
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "list_set_aside_codes",
    { title: "List set-aside codes", description: "List SAM.gov set-aside codes and their meanings.", inputSchema: {} },
    async () => text(Object.entries(SET_ASIDE_CODES).map(([code, description]) => ({ code, description }))),
  );

  return server;
}
