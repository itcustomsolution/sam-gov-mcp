/**
 * Minimal read-only client for the public SAM.gov Get Opportunities API (v2).
 * Docs: https://open.gsa.gov/api/get-opportunities-public-api/
 */
export const SAM_BASE_URL = "https://api.sam.gov/opportunities/v2/search";

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

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export class SamGovError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "SamGovError";
  }
}

/** Accepts yyyy-mm-dd or MM/dd/yyyy and returns MM/dd/yyyy (the format SAM.gov requires). */
export function toSamDate(input: string): string {
  const t = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const [y, m, d]: string[] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : ["", "", ""];
  if (y) {
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    // Reject impossible dates like 2026-13-45 instead of silently rolling them over.
    if (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d) return `${m}/${d}/${y}`;
  }
  throw new SamGovError(`Invalid date "${input}". Use YYYY-MM-DD or MM/DD/YYYY.`);
}

function parseSam(d: string): Date {
  const [m, day, y] = d.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function buildSearchUrl(apiKey: string, p: SearchParams, base = SAM_BASE_URL): string {
  const from = toSamDate(p.postedFrom);
  const to = toSamDate(p.postedTo);
  const days = (parseSam(to).getTime() - parseSam(from).getTime()) / 86400000;
  if (days < 0) throw new SamGovError("postedFrom must be on or before postedTo.");
  if (days > 365) throw new SamGovError("SAM.gov allows a posted date range of at most 1 year.");
  const q = new URLSearchParams();
  q.set("api_key", apiKey);
  q.set("postedFrom", from);
  q.set("postedTo", to);
  q.set("limit", String(Math.min(Math.max(p.limit ?? 10, 1), 1000)));
  q.set("offset", String(Math.max(p.offset ?? 0, 0)));
  if (p.keywords) q.set("title", p.keywords);
  if (p.naics) {
    if (!/^\d{2,6}$/.test(p.naics)) throw new SamGovError("naics must be 2-6 digits.");
    q.set("ncode", p.naics);
  }
  if (p.setAside) {
    if (!Object.prototype.hasOwnProperty.call(SET_ASIDE_CODES, p.setAside))
      throw new SamGovError(`Unknown set-aside code "${p.setAside}". Call list_set_aside_codes.`);
    q.set("typeOfSetAside", p.setAside);
  }
  if (p.state) {
    if (!/^[A-Za-z]{2}$/.test(p.state)) throw new SamGovError("state must be a 2-letter code.");
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
  if (key && key.length >= 8) out = out.split(key).join("REDACTED");
  return out;
}

/** Hard cap on how much of an upstream response we will read (defends against huge/malicious bodies). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

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
      const body = redactKey(await res.text().catch(() => ""), this.apiKey);
      throw new SamGovError(`SAM.gov returned HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    const raw = await res.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new SamGovError("SAM.gov response too large; narrow the search.");
    try {
      return JSON.parse(raw);
    } catch {
      throw new SamGovError("SAM.gov returned a non-JSON response.");
    }
  }

  async search(p: SearchParams): Promise<{ total: number; results: OpportunitySummary[] }> {
    const data = await this.get(buildSearchUrl(this.apiKey, p, this.base));
    const list = Array.isArray(data?.opportunitiesData) ? data.opportunitiesData : [];
    return JSON.parse(redactKey(JSON.stringify({ total: Number(data?.totalRecords ?? list.length), results: list.map(summarize) }), this.apiKey));
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
    return JSON.parse(redactKey(JSON.stringify(o), this.apiKey));
  }
}
