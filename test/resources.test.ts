// r6 resource bounds (R5-SAM-RES): a reply that makes the key check expensive is refused or stopped, never allowed to
// hold the call or the server. Small synthetic inputs only (at most a few hundred KB), mocked fetch, synthetic key.
import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SamGovClient, SamGovError, redactDeep, CHECK_LIMITS } from "../src/samgov.js";
import { createServer } from "../src/server.js";

const KEY = "SYNTHETIC-sentinel-key-0123456789abcdef";
const range = { postedFrom: "2026-01-01", postedTo: "2026-01-31" };
const streamOf = (str: string) => {
  const bytes = new TextEncoder().encode(str);
  let sent = false;
  return new ReadableStream<Uint8Array>({ pull(c) { if (sent) return c.close(); sent = true; c.enqueue(bytes); } });
};
const reply = (body: unknown) => vi.fn(async (_u: string, _i?: unknown) => ({ ok: true, status: 200, body: streamOf(typeof body === "string" ? body : JSON.stringify(body)) }));
const notice = (extra: Record<string, unknown>) => ({ totalRecords: 1, opportunitiesData: [{ noticeId: "n1", title: "Synthetic notice", ...extra }] });
const err = async (p: Promise<unknown>) => (await p.then(() => undefined, (e) => e)) as SamGovError | undefined;
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const nested8 = () => { let u = "S"; for (let i = 0; i < 8; i++) u = [...u].map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""); return u + " "; };
const fill = (u: string, chars: number) => u.repeat(Math.max(1, Math.floor(chars / u.length)));
const small = { baseUnits: 1 }; // the default per-character budget without the fixed allowance, so a few KB can exhaust it

describe("R5-SAM-RES: the check is bounded before it is expensive", () => {
  it("a reply whose text NFKC expands many times is refused before any scan (U+FDFA, U+33AF)", async () => {
    for (const cp of [0xfdfa, 0x33af]) {
      const e = await err(new SamGovClient(KEY, reply(notice({ x: fill(String.fromCodePoint(cp), 2000) }))).getOpportunity("n1"));
      expect(e?.code).toBe("RESPONSE_TOO_COMPLEX");
      expect(e?.message).not.toContain(String.fromCodePoint(cp));
    }
  });

  it("pathological encoding (eight nested percent-encodings) exhausts the work budget: refused, nothing returned", async () => {
    const body = notice({ x: fill(nested8(), 20000), k: KEY });
    const e = await err(new SamGovClient(KEY, reply(body), undefined, undefined, { limits: small }).getOpportunity("n1"));
    expect(e?.code).toBe("RESPONSE_TOO_COMPLEX");
    expect(e?.message).not.toContain(KEY);
    expect(e?.message).not.toMatch(/%25|SYNTHETIC/);
  });

  it("an ordinary reply of the same size passes under the same budget", async () => {
    const o = await new SamGovClient(KEY, reply(notice({ x: fill("lorem ipsum dolor ", 20000) })), undefined, undefined, { limits: small }).getOpportunity("n1");
    expect(o?.noticeId).toBe("n1");
  });

  it("budget exhaustion in the joined reading (fields that decode further when read end to end) is a refusal", () => {
    const v = { x: fill("lorem ipsum dolor ", 20000), a: "Tom &amp;amp;amp;", b: "amp;amp;amp;amp;amp; Jerry" };
    expect(() => redactDeep(v, KEY, small)).toThrowError(expect.objectContaining({ code: "RESPONSE_TOO_COMPLEX" }));
    expect(redactDeep(v, KEY).x).toBe(v.x); // within the default fixed allowance at this size
  });

  it("the budget is deterministic: the same reply is refused or passes the same way every time", () => {
    const v = { x: fill(nested8(), 20000) };
    const outcomes = Array.from({ length: 3 }, () => { try { redactDeep(v, KEY, small); return "ok"; } catch (e) { return (e as SamGovError).code; } });
    expect(new Set(outcomes)).toEqual(new Set(["RESPONSE_TOO_COMPLEX"]));
  });

  it("deep nesting is refused by the structure limits before the check", async () => {
    let deep: unknown = "x";
    for (let i = 0; i < 40; i++) deep = { d: deep };
    expect((await err(new SamGovClient(KEY, reply(notice({ deep }))).getOpportunity("n1")))?.code).toBe("INVALID_RESPONSE");
  });

  it("redaction coverage is unchanged inside the budget: an encoded key is still removed", async () => {
    const enc = [...KEY].map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const o = await new SamGovClient(KEY, reply(notice({ x: `see ${enc} here`, y: KEY }))).getOpportunity("n1");
    expect(JSON.stringify(o)).not.toContain(KEY);
    expect(JSON.stringify(o)).not.toContain(enc);
  });

  it("the defaults are the documented ones", () => {
    expect(CHECK_LIMITS).toEqual({ unitsPerChar: 48, unitsPerEscape: 32, baseUnits: 1_000_000, maxGrowth: 4, memoryMb: 256 });
  });
});

describe("R5-SAM-RES: one deadline and cancellation stop the check itself", () => {
  it("a check that never finishes is stopped at the deadline while this thread keeps running", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const t0 = Date.now();
    const e = await err(new SamGovClient(KEY, reply(notice({})), undefined, 300, { workerUrl: fixture("spin-worker.mjs") }).getOpportunity("n1"));
    clearInterval(timer);
    expect(e?.code).toBe("TIMEOUT");
    expect(e?.message).toBe("Checking the SAM.gov response did not finish within 300 ms; nothing was returned.");
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ticks).toBeGreaterThan(5); // the event loop was free while the worker spun
  });

  it("the deadline covers the request and the check together", async () => {
    const slow = vi.fn(async () => { await new Promise((r) => setTimeout(r, 250)); return { ok: true, status: 200, body: streamOf(JSON.stringify(notice({}))) }; });
    const e = await err(new SamGovClient(KEY, slow, undefined, 400, { workerUrl: fixture("spin-worker.mjs") }).getOpportunity("n1"));
    expect(e?.code).toBe("TIMEOUT");
    expect(e?.message).toContain("Checking the SAM.gov response did not finish within 400 ms");
  });

  it("cancellation during the check stops it and says so", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const t0 = Date.now();
    const e = await err(new SamGovClient(KEY, reply(notice({})), undefined, 30000, { workerUrl: fixture("spin-worker.mjs") }).getOpportunity("n1", 365, { signal: ac.signal }));
    expect(e?.code).toBe("CANCELLED");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("cancellation during the request stops it and says so", async () => {
    const ac = new AbortController();
    const hang = vi.fn((_u: string, init?: { signal?: AbortSignal }) => new Promise<never>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason))));
    setTimeout(() => ac.abort(), 50);
    const e = await err(new SamGovClient(KEY, hang as any, undefined, 30000).search(range, { signal: ac.signal }));
    expect(e?.code).toBe("CANCELLED");
    expect((hang.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  });

  it("an already cancelled call does no work", async () => {
    const f = reply(notice({}));
    const e = await err(new SamGovClient(KEY, f).search(range, { signal: AbortSignal.abort() }));
    expect(e?.code).toBe("CANCELLED");
  });

  it("a check that runs out of its memory limit is a refusal, and this process carries on", async () => {
    const e = await err(new SamGovClient(KEY, reply(notice({})), undefined, 30000, { workerUrl: fixture("oom-worker.mjs"), limits: { memoryMb: 16 } }).getOpportunity("n1"));
    expect(e?.code).toBe("RESPONSE_TOO_COMPLEX");
    expect(e?.message).toContain("needs more than 16 MB");
    expect((await new SamGovClient(KEY, reply(notice({}))).getOpportunity("n1"))?.noticeId).toBe("n1");
  });

  it("limits are validated", () => {
    expect(() => new SamGovClient(KEY, reply({}), undefined, undefined, { limits: { memoryMb: 1 } })).toThrow(/memoryMb/);
    expect(() => new SamGovClient(KEY, reply({}), undefined, undefined, { limits: { unitsPerChar: 0 } })).toThrow(/positive integers/);
  });
});

describe("R5-SAM-RES: the MCP tools pass the client's cancellation through", () => {
  it("a cancelled tool call aborts the request it started", async () => {
    let seen: AbortSignal | undefined;
    const hang = vi.fn((_u: string, init?: { signal?: AbortSignal }) => { seen = init?.signal; return new Promise<never>(() => {}); });
    const server = createServer({ apiKey: KEY, fetchImpl: hang as any });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "synthetic", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const ac = new AbortController();
    const call = client.callTool({ name: "search_opportunities", arguments: { posted_from: "2026-01-01", posted_to: "2026-01-31" } }, undefined, { signal: ac.signal });
    await vi.waitFor(() => expect(hang).toHaveBeenCalled());
    ac.abort();
    await call.catch(() => undefined);
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });
});

describe("R6: packaged metadata matches the package", () => {
  it("server.json, package.json, package-lock.json and the server's VERSION agree", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
    const pkg = read("package.json"), lock = read("package-lock.json"), reg = read("server.json");
    const { VERSION } = await import("../src/server.js");
    expect([lock.version, lock.packages[""].version, reg.version, reg.packages[0].version, VERSION]).toEqual(Array(5).fill(pkg.version));
  });
});

describe("R6 review round 1 (omar): output form, main-thread text, concurrency", () => {
  const ctl = (n: number) => String.fromCharCode(n);
  it("OM-R6-01: a key written with control characters for letters is caught in the form the output writes it", async () => {
    const bad = KEY.replace("b", ctl(8)).replace("f", ctl(12)); // JSON writes these as \b and \f
    const o = await new SamGovClient(KEY, reply(notice({ x: bad }))).getOpportunity("n1");
    const out = JSON.stringify(o, null, 2);
    expect(out).not.toContain("a\\bcde\\f");
    expect(o?.x).toBe("REDACTED");
  });

  it("OM-R6-01: the same key split across two fields is refused, not returned", async () => {
    const bad = KEY.replace("b", ctl(8)).replace("f", ctl(12));
    const e = await err(new SamGovClient(KEY, reply(notice({ x: bad.slice(0, 30), y: bad.slice(30) }))).getOpportunity("n1"));
    expect(e?.code).toBe("INVALID_RESPONSE");
  });

  it("OM-R6-02: a huge network error message is cut before it is redacted on this thread", async () => {
    const boom = vi.fn(async () => { throw new Error("%41".repeat(4 << 20) + KEY); }); // 12 MB of escapes: seconds if redacted whole
    const t0 = Date.now();
    const e = await err(new SamGovClient(KEY, boom as any).search(range));
    expect(e?.code).toBe("NETWORK_ERROR");
    expect(e?.message.length).toBeLessThan(400);
    expect(e?.message).not.toContain(KEY);
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("OM-R6-05: at most two checks run at once; a third waits under its own deadline and says it did not start", async () => {
    const mk = (ms: number) => new SamGovClient(KEY, reply(notice({})), undefined, ms, { workerUrl: fixture("spin-worker.mjs") }).getOpportunity("n1");
    // Two checks hold both slots for 900 ms; the third, with a 300 ms deadline, can only time out while it waits.
    const errs = await Promise.all([mk(900), mk(900), mk(300)].map(err));
    expect(errs.map((e) => e?.code)).toEqual(["TIMEOUT", "TIMEOUT", "TIMEOUT"]);
    expect(errs[2]?.message).toBe("Checking the SAM.gov response did not start within 300 ms (other checks were running); nothing was returned.");
    expect(errs[0]?.message).toContain("did not finish within 900 ms");
    expect((await new SamGovClient(KEY, reply(notice({}))).getOpportunity("n1"))?.noticeId).toBe("n1"); // slots released
  });
});
