/**
 * Minimal read-only client for the public SAM.gov Get Opportunities API (v2).
 * Docs: https://open.gsa.gov/api/get-opportunities-public-api/
 */
export const SAM_BASE_URL = "https://api.sam.gov/opportunities/v2/search";
export const MAX_PAGE_SIZE = 1000; // The MCP tool keeps its existing, smaller 100-record limit.
export const MAX_PAGE_INDEX = 1_000_000;
export const MAX_KEYWORDS_LENGTH = 1000;
export const MAX_NOTICE_ID_LENGTH = 128;
export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_NODES = 50_000;

export const SET_ASIDE_CODES: Record<string, string> = {
  SBA: "Total Small Business Set-Aside (FAR 19.5)",
  SBP: "Partial Small Business Set-Aside (FAR 19.5)",
  "8A": "8(a) Set-Aside (FAR 19.8)",
  "8AN": "8(a) Sole Source (FAR 19.8)",
  HZC: "Historically Underutilized Business (HUBZone) Set-Aside (FAR 19.13)",
  HZS: "HUBZone Sole Source (FAR 19.13)",
  SDVOSBC: "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)",
  SDVOSBS: "SDVOSB Sole Source (FAR 19.14)",
  WOSB: "Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)",
  WOSBSS: "WOSB Program Sole Source (FAR 19.15)",
  EDWOSB: "Economically Disadvantaged WOSB (EDWOSB) Program Set-Aside (FAR 19.15)",
  EDWOSBSS: "EDWOSB Program Sole Source (FAR 19.15)",
  LAS: "Local Area Set-Aside (FAR 26.2)",
  IEE: "Indian Economic Enterprise (IEE) Set-Aside (DOI)",
  ISBEE: "Indian Small Business Economic Enterprise (ISBEE) Set-Aside (DOI)",
  BICiv: "Buy Indian Set-Aside (HHS, IHS)",
  VSA: "Veteran-Owned Small Business Set-Aside (VA)",
  VSS: "Veteran-Owned Small Business Sole Source (VA)",
};

export interface SearchParams {
  keywords?: string;
  naics?: string;
  setAside?: string;
  postedFrom: string; // MM/dd/yyyy or yyyy-mm-dd
  postedTo: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export interface OpportunitySummary {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  agency?: string;
  postedDate?: string;
  responseDeadline?: string;
  type?: string;
  setAside?: string;
  naics?: string;
  state?: string;
  uiLink?: string;
}

export interface SearchResult {
  total: number;
  results: OpportunitySummary[];
  pagination: {
    page_index: number;
    page_size: number;
    returned_count: number;
    partial: boolean;
    has_more: boolean;
    next_offset: number | null;
  };
}

/** Minimal fetch shape. `body` must be a byte stream; the client never calls text()/json(). */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}>;

export class SamGovError extends Error {
  constructor(message: string, public status?: number, public code = "INVALID_INPUT") {
    super(message);
    this.name = "SamGovError";
  }
}

/** Accepts yyyy-mm-dd or MM/dd/yyyy and returns MM/dd/yyyy (the format SAM.gov requires). */
export function toSamDate(input: string): string {
  if (typeof input !== "string" || input.length > 32) throw new SamGovError("Invalid date. Use YYYY-MM-DD or MM/DD/YYYY.");
  const t = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const [y, m, d]: string[] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : ["", "", ""];
  if (y) {
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    // Reject impossible dates like 2026-13-45 instead of silently rolling them over.
    if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d) return `${m}/${d}/${y}`;
  }
  throw new SamGovError("Invalid date. Use YYYY-MM-DD or MM/DD/YYYY.");
}

function parseSam(d: string): Date {
  const [m, day, y] = d.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function buildSearchUrl(apiKey: string, p: SearchParams, base = SAM_BASE_URL): string {
  if (!p || typeof p !== "object") throw new SamGovError("Search parameters are required.");
  const from = toSamDate(p.postedFrom);
  const to = toSamDate(p.postedTo);
  const days = (parseSam(to).getTime() - parseSam(from).getTime()) / 86400000;
  if (days < 0) throw new SamGovError("postedFrom must be on or before postedTo.");
  if (days > 365) throw new SamGovError("SAM.gov allows a posted date range of at most 1 year.");
  const limit = p.limit ?? 10;
  const offset = p.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new SamGovError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_PAGE_INDEX) throw new SamGovError(`offset must be a zero-based page index from 0 to ${MAX_PAGE_INDEX}.`);
  if (p.keywords !== undefined && (typeof p.keywords !== "string" || p.keywords.length > MAX_KEYWORDS_LENGTH)) throw new SamGovError(`keywords must be at most ${MAX_KEYWORDS_LENGTH} characters.`);
  const q = new URLSearchParams();
  q.set("api_key", apiKey);
  q.set("postedFrom", from);
  q.set("postedTo", to);
  q.set("limit", String(limit));
  q.set("offset", String(offset));
  if (p.keywords) q.set("title", p.keywords);
  if (p.naics) {
    if (typeof p.naics !== "string" || !/^\d{2,6}$/.test(p.naics)) throw new SamGovError("naics must be 2-6 digits.");
    q.set("ncode", p.naics);
  }
  if (p.setAside) {
    if (typeof p.setAside !== "string" || !Object.prototype.hasOwnProperty.call(SET_ASIDE_CODES, p.setAside))
      throw new SamGovError("Unknown set-aside code. Call list_set_aside_codes.");
    q.set("typeOfSetAside", p.setAside);
  }
  if (p.state) {
    if (typeof p.state !== "string" || !/^[A-Za-z]{2}$/.test(p.state)) throw new SamGovError("state must be a 2-letter code.");
    q.set("state", p.state.toUpperCase());
  }
  return `${base}?${q.toString()}`;
}

export function summarize(o: any): OpportunitySummary {
  return {
    noticeId: o.noticeId,
    title: o.title,
    solicitationNumber: o.solicitationNumber ?? undefined,
    agency: o.fullParentPathName ?? undefined,
    postedDate: o.postedDate ?? undefined,
    responseDeadline: o.responseDeadLine ?? undefined,
    type: o.type ?? undefined,
    setAside: o.typeOfSetAside ?? undefined,
    naics: o.naicsCode ?? undefined,
    state: o.placeOfPerformance?.state?.code ?? undefined,
    uiLink: o.uiLink ?? undefined,
  };
}

/** Removes the api_key query value from any string (e.g. links echoed by the API). */
export function redactKey(s: string, key?: string): string {
  let out = s.replace(/api_key=[^&\s"']+/gi, "api_key=REDACTED");
  // Also remove the literal key wherever an upstream error might echo it.
  if (key) out = out.split(key).join("REDACTED");
  return out;
}

/** Hard cap on how much of an upstream response we will read (defends against huge/malicious bodies). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Error bodies are only quoted (300 chars), so read at most this much of them. */
export const MAX_ERROR_BODY_BYTES = 16 * 1024;

/** Recursively redact every string (keys and values) in a parsed JSON value. */
export function redactDeep<T>(value: T, key?: string): T {
  let nodes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new SamGovError("SAM.gov response exceeds JSON structure limits; narrow the search.", undefined, "INVALID_RESPONSE");
    if (typeof v === "string") return redactKey(v, key);
    if (Array.isArray(v)) return v.map((item) => visit(item, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v)) {
        // Define rather than assign so an upstream __proto__ key remains data.
        Object.defineProperty(out, redactKey(k, key), { value: visit(item, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return out;
    }
    return v;
  };
  return visit(value, 0) as T;
}

type Opportunity = Record<string, unknown> & { noticeId: string; title: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validNoticeId = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_NOTICE_ID_LENGTH && /^[A-Za-z0-9-]+$/.test(value);

/** Validate the upstream contract without echoing any untrusted field or error envelope. */
function parseOpportunities(data: unknown, limit: number, offset: number): { total: number; list: Opportunity[] } {
  const invalid = () => new SamGovError("SAM.gov returned an invalid opportunities response; no results can be trusted.", undefined, "INVALID_RESPONSE");
  if (!record(data) || !Number.isSafeInteger(data.totalRecords) || (data.totalRecords as number) < 0 || !Array.isArray(data.opportunitiesData)) throw invalid();
  if (Object.keys(data).some((k) => /^(error|errors|errorMessage)$/i.test(k))) throw invalid();
  const total = data.totalRecords as number;
  const list = data.opportunitiesData;
  if (list.length > limit || total < list.length || (list.length > 0 && offset * limit + list.length > total)) throw invalid();
  if (data.offset !== undefined && data.offset !== offset) throw invalid();
  if (data.limit !== undefined && data.limit !== limit) throw invalid();
  for (const o of list) {
    if (!record(o) || !validNoticeId(o.noticeId) || typeof o.title !== "string" || o.title.length > 8192) throw invalid();
    for (const field of ["solicitationNumber", "fullParentPathName", "postedDate", "responseDeadLine", "type", "typeOfSetAside", "naicsCode", "uiLink"]) {
      if (o[field] !== undefined && o[field] !== null && (typeof o[field] !== "string" || o[field].length > 8192)) throw invalid();
    }
    if (o.placeOfPerformance !== undefined && o.placeOfPerformance !== null) {
      if (!record(o.placeOfPerformance)) throw invalid();
      const state = o.placeOfPerformance.state;
      if (state !== undefined && state !== null && (!record(state) || (state.code !== undefined && state.code !== null && typeof state.code !== "string"))) throw invalid();
    }
  }
  return { total, list: list as Opportunity[] };
}

export class ResponseTooLarge extends Error {}

/**
 * Read a byte stream, counting bytes as they arrive and cancelling the stream as soon as the
 * running total exceeds `max`. At most `max` bytes plus one chunk are ever held. Decoding is
 * streaming UTF-8, so multibyte characters split across chunks are handled.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel("response exceeds size cap").catch(() => {});
        throw new ResponseTooLarge(`response exceeds ${max} bytes`);
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

export class SamGovClient {
  constructor(
    private apiKey: string,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private base = SAM_BASE_URL,
  ) {
    if (!apiKey) throw new SamGovError("SAM_API_KEY is not set. Get a free key at https://sam.gov (Account Details > API Key).");
  }

  private async get(url: string): Promise<any> {
    let res;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) } as any);
    } catch (e) {
      // Network errors can carry the request URL (which contains the key); never pass them through raw.
      throw new SamGovError(`Could not reach SAM.gov: ${redactKey(String((e as Error)?.message ?? e), this.apiKey)}`);
    }
    // Per the Get Opportunities API docs, HTTP 404 means "No Data found", not an error.
    if (res.status === 404) return { totalRecords: 0, opportunitiesData: [] };
    if (!res.ok) {
      let body: string;
      try {
        body = await readCapped(res.body, MAX_ERROR_BODY_BYTES);
      } catch (e) {
        body = e instanceof ResponseTooLarge ? "(error body too large; not read)" : "(error body could not be read)";
      }
      throw new SamGovError(`SAM.gov returned HTTP ${res.status}: ${redactKey(body, this.apiKey).slice(0, 300)}`, res.status);
    }
    let raw: string;
    try {
      raw = await readCapped(res.body, MAX_RESPONSE_BYTES);
    } catch (e) {
      if (e instanceof ResponseTooLarge) throw new SamGovError("SAM.gov response too large; narrow the search.");
      throw new SamGovError(`Failed reading SAM.gov response: ${redactKey(String((e as Error)?.message ?? e), this.apiKey)}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new SamGovError("SAM.gov returned a non-JSON response.");
    }
  }

  async search(p: SearchParams): Promise<{ total: number; results: OpportunitySummary[] }> {
    const data = await this.get(buildSearchUrl(this.apiKey, p, this.base));
    const list = Array.isArray(data?.opportunitiesData) ? data.opportunitiesData : [];
    return redactDeep({ total: Number(data?.totalRecords ?? list.length), results: list.map(summarize) }, this.apiKey);
  }

  async getOpportunity(noticeId: string, lookbackDays = 365): Promise<any | null> {
    if (!/^[A-Za-z0-9-]+$/.test(noticeId)) throw new SamGovError("Invalid noticeId.");
    const to = new Date();
    const from = new Date(to.getTime() - Math.min(lookbackDays, 365) * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = buildSearchUrl(this.apiKey, { postedFrom: fmt(from), postedTo: fmt(to), limit: 1 }, this.base) +
      `&noticeid=${encodeURIComponent(noticeId)}`;
    const data = await this.get(url);
    const o = data?.opportunitiesData?.[0];
    if (!o) return null;
    return redactDeep(o, this.apiKey);
  }
}
