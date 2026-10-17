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
const streamOf = (str: string, chunk = 1024) => {
  const bytes = new TextEncoder().encode(str);
  let i = 0;
  return new ReadableStream<Uint8Array>({ pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i + chunk)); i += chunk; } });
};
const okFetch = (body: any) => vi.fn(async (_u: string) => ({ ok: true, status: 200, body: streamOf(JSON.stringify(body)) }));

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
    const f = vi.fn(async () => ({ ok: false, status: 403, body: streamOf("bad api_key=K") }));
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

describe("HTTP 404 from SAM.gov", () => {
  it("is treated as no results, not an error", async () => {
    // Shape note (0.2.0): results now also carry pagination and source (SAM-04); the zero-result
    // contract below is unchanged. The body must be cancelled, not abandoned (SAM-03).
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new TextEncoder().encode("{}")); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const f = async () => ({ ok: false, status: 404, body });
    const c = new SamGovClient("k", f as any);
    const r = await c.search({ postedFrom: "2026-09-01", postedTo: "2026-10-01" } as any);
    expect(r).toMatchObject({ total: 0, results: [] });
    expect(r.pagination).toMatchObject({ returned_count: 0, has_more: false, next_offset: null, partial: false });
    expect(cancelled).toBe(true);
  });
});

describe("security audit regressions", () => {
  const KEY = "LIVEKEY-abcdef1234567890";
  it("exploit: upstream error echoing the raw key does not leak it", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 403, body: streamOf(`invalid key ${KEY} supplied`) }));
    await expect(new SamGovClient(KEY, f as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" })).rejects.toThrow(/REDACTED/);
    await expect(new SamGovClient(KEY, f as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" })).rejects.not.toThrow(new RegExp(KEY));
  });
  it("exploit: network error carrying the request URL does not leak the key", async () => {
    const f = vi.fn(async (u: string) => { throw new Error(`connect ECONNREFUSED ${u}`); });
    const err = await new SamGovClient(KEY, f as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" }).catch((e) => e);
    expect(String(err.message)).not.toContain(KEY);
  });
  it("exploit: key echoed anywhere in result JSON is redacted", async () => {
    const body = { totalRecords: 1, opportunitiesData: [{ noticeId: "n1", title: `see ${KEY}` }] };
    const r = await new SamGovClient(KEY, okFetch(body) as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it("exploit: prototype keys are not accepted as set-aside codes", () => {
    for (const k of ["constructor", "toString", "__proto__"])
      expect(() => buildSearchUrl("K", { postedFrom: "2026-01-01", postedTo: "2026-01-02", setAside: k })).toThrow(/set-aside/);
  });
  it("impossible dates are rejected, not rolled over", () => {
    expect(() => toSamDate("2026-13-45")).toThrow(SamGovError);
    expect(() => toSamDate("02/30/2026")).toThrow(SamGovError);
  });
});

describe("streamed body limits (independent audit follow-up)", async () => {
  const { readCapped, MAX_RESPONSE_BYTES, MAX_ERROR_BODY_BYTES, redactDeep } = await import("../src/samgov.js");
  const KEY = "LIVEKEY-abcdef1234567890";
  // A synthetic stream that would be endless; counts pulled chunks and records cancellation.
  const endless = (chunk = 64 * 1024) => {
    const st = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { st.pulled++; if (st.pulled > 10_000) return c.error(new Error("test safety stop")); c.enqueue(new Uint8Array(chunk).fill(0x61)); },
      cancel() { st.cancelled = true; },
    }, { highWaterMark: 0 });
    return { stream, st };
  };

  it("streamed overflow on success path stops reading at the cap and cancels", async () => {
    const { stream, st } = endless();
    const f = vi.fn(async () => ({ ok: true, status: 200, body: stream }));
    await expect(new SamGovClient(KEY, f as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" })).rejects.toThrow(/too large/);
    expect(st.cancelled).toBe(true);
    // never pulled more than cap/chunk + small read-ahead: proves no unbounded allocation
    expect(st.pulled).toBeLessThanOrEqual(Math.ceil(MAX_RESPONSE_BYTES / (64 * 1024)) + 3);
  });

  it("error-body overflow reads at most the error cap and cancels", async () => {
    const { stream, st } = endless(4096);
    const f = vi.fn(async () => ({ ok: false, status: 500, body: stream }));
    await expect(new SamGovClient(KEY, f as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" })).rejects.toThrow(/HTTP 500: \(error body too large/);
    expect(st.cancelled).toBe(true);
    expect(st.pulled).toBeLessThanOrEqual(Math.ceil(MAX_ERROR_BODY_BYTES / 4096) + 3);
  });

  it("multibyte UTF-8 split across chunks decodes correctly", async () => {
    const txt = JSON.stringify({ totalRecords: 1, opportunitiesData: [{ noticeId: "n", title: "Café — 日本語 ✓" }] });
    const r = await new SamGovClient(KEY, (async () => ({ ok: true, status: 200, body: streamOf(txt, 1) })) as any)
      .search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" });
    expect(r.results[0].title).toBe("Café — 日本語 ✓");
  });

  it("byte cap counts bytes, not UTF-16 chars", async () => {
    await expect(readCapped(streamOf("é".repeat(6)), 11)).rejects.toThrow(/exceeds/); // 12 bytes
    expect(await readCapped(streamOf("é".repeat(5)), 11)).toBe("ééééé");
  });

  it("body-read failure becomes a redacted SamGovError", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error(`socket reset for api_key=${KEY}`)); } });
    const err = await new SamGovClient(KEY, (async () => ({ ok: true, status: 200, body: stream })) as any)
      .search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" }).catch((e) => e);
    expect(err).toBeInstanceOf(SamGovError);
    expect(err.message).toMatch(/Failed reading/);
    expect(err.message).not.toContain(KEY);
  });

  it("error-body read failure still yields a clean SamGovError", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error("boom")); } });
    await expect(new SamGovClient(KEY, (async () => ({ ok: false, status: 502, body: stream })) as any)
      .search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" })).rejects.toThrow(/HTTP 502: \(error body could not be read\)/);
  });

  it("quoted and backslash text survives redaction intact (parsed values, not serialized JSON)", async () => {
    const title = `He said "api_key=${KEY}" \\ and \"quoted\" ${KEY}\\`;
    const body = { totalRecords: 1, opportunitiesData: [{ noticeId: "n1", title }] };
    const r = await new SamGovClient(KEY, okFetch(body) as any).search({ postedFrom: "2026-01-01", postedTo: "2026-01-02" });
    expect(r.results[0].title).toBe(title.replace(`api_key=${KEY}`, "api_key=REDACTED").split(KEY).join("REDACTED"));
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(redactDeep({ [KEY]: [1, null, true, `x${KEY}`] }, KEY)).toEqual({ REDACTED: [1, null, true, "xREDACTED"] });
  });
});
