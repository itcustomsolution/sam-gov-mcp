import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildSearchUrl, toSamDate, SamGovClient, redactKey, SamGovError } from "../src/samgov.js";
import { createServer } from "../src/server.js";

const sample = {
  totalRecords: 1,
  opportunitiesData: [{
    noticeId: "abc123", title: "IT Help Desk Support", solicitationNumber: "SOL-1",
    fullParentPathName: "EXAMPLE AGENCY", postedDate: "2026-09-01", responseDeadLine: "2026-10-01T17:00:00-04:00",
    type: "Solicitation", typeOfSetAside: "SBA", naicsCode: "541512",
    placeOfPerformance: { state: { code: "MD" } }, uiLink: "https://sam.gov/opp/abc123/view",
    links: [{ href: "https://api.sam.gov/x?api_key=SECRET123" }],
  }],
};
const okFetch = (body: any) => vi.fn(async (_u: string) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }));

describe("helpers", () => {
  it("converts dates", () => {
    expect(toSamDate("2026-09-01")).toBe("09/01/2026");
    expect(toSamDate("09/01/2026")).toBe("09/01/2026");
    expect(() => toSamDate("Sept 1")).toThrow(SamGovError);
  });
  it("builds URL with filters", () => {
    const u = new URL(buildSearchUrl("K", { keywords: "help desk", naics: "541512", setAside: "SBA", postedFrom: "2026-01-01", postedTo: "2026-02-01", state: "md" }));
    expect(u.searchParams.get("title")).toBe("help desk");
    expect(u.searchParams.get("ncode")).toBe("541512");
    expect(u.searchParams.get("typeOfSetAside")).toBe("SBA");
    expect(u.searchParams.get("state")).toBe("MD");
    expect(u.searchParams.get("postedFrom")).toBe("01/01/2026");
  });
  it("rejects bad input", () => {
    expect(() => buildSearchUrl("K", { postedFrom: "2024-01-01", postedTo: "2026-01-01" })).toThrow(/1 year/);
    expect(() => buildSearchUrl("K", { postedFrom: "2026-02-01", postedTo: "2026-01-01" })).toThrow();
    expect(() => buildSearchUrl("K", { postedFrom: "2026-01-01", postedTo: "2026-01-02", setAside: "NOPE" })).toThrow(/set-aside/);
    expect(() => buildSearchUrl("K", { postedFrom: "2026-01-01", postedTo: "2026-01-02", naics: "abc" })).toThrow();
  });
  it("redacts keys", () => expect(redactKey("a?api_key=XYZ&b=1")).toBe("a?api_key=REDACTED&b=1"));
  it("requires key", () => expect(() => new SamGovClient("")).toThrow(/SAM_API_KEY/));
});

describe("client", () => {
  it("summarizes search results", async () => {
    const f = okFetch(sample);
    const r = await new SamGovClient("K", f as any).search({ postedFrom: "2026-09-01", postedTo: "2026-09-30" });
    expect(r.total).toBe(1);
    expect(r.results[0]).toMatchObject({ noticeId: "abc123", agency: "EXAMPLE AGENCY", state: "MD", setAside: "SBA" });
  });
  it("gets one opportunity and redacts key", async () => {
    const f = okFetch(sample);
    const o = await new SamGovClient("K", f as any).getOpportunity("abc123");
    expect(f.mock.calls[0][0]).toContain("noticeid=abc123");
    expect(JSON.stringify(o)).not.toContain("SECRET123");
  });
  it("surfaces HTTP errors without leaking key", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "bad api_key=K" }));
    await expect(new SamGovClient("K", f as any).search({ postedFrom: "2026-09-01", postedTo: "2026-09-02" })).rejects.toThrow(/403.*REDACTED/);
  });
});

describe("MCP server", () => {
  async function connect(fetchImpl: any, apiKey = "K") {
    const server = createServer({ apiKey, fetchImpl });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  it("lists three tools", async () => {
    const c = await connect(okFetch(sample));
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_opportunity", "list_set_aside_codes", "search_opportunities"]);
  });
  it("search_opportunities returns JSON", async () => {
    const c = await connect(okFetch(sample));
    const r: any = await c.callTool({ name: "search_opportunities", arguments: { posted_from: "2026-09-01", posted_to: "2026-09-30", naics: "541512" } });
    expect(JSON.parse(r.content[0].text).results[0].noticeId).toBe("abc123");
  });
  it("get_opportunity not found is an error", async () => {
    const c = await connect(okFetch({ totalRecords: 0, opportunitiesData: [] }));
    const r: any = await c.callTool({ name: "get_opportunity", arguments: { notice_id: "zzz" } });
    expect(r.isError).toBe(true);
  });
  it("missing key is a tool error", async () => {
    const c = await connect(okFetch(sample), "");
    const r: any = await c.callTool({ name: "search_opportunities", arguments: { posted_from: "2026-09-01", posted_to: "2026-09-02" } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/SAM_API_KEY/);
  });
  it("list_set_aside_codes", async () => {
    const c = await connect(okFetch(sample));
    const r: any = await c.callTool({ name: "list_set_aside_codes", arguments: {} });
    expect(JSON.parse(r.content[0].text).some((x: any) => x.code === "SDVOSBC")).toBe(true);
  });
});
