# Changelog

## [0.2.0-rc.2] - unreleased candidate (2026-10-17, not published; 0.2.0-rc.1 of 2026-10-16 was the independently audited candidate)

**Breaking:** malformed or mismatched SAM.gov responses are now tool errors; search results gain `pagination` and
`source`; `get_opportunity` returns `{source, notice}`; tool errors are JSON objects with a `code`; Node 22 or later
is required; the exported `buildSearchUrl` rejects out-of-range `limit`/`offset` instead of clamping them.

- SAM-01: success responses are validated against the documented envelope (`totalRecords`, `opportunitiesData`,
  echoed `limit`/`offset`, record field types). An error envelope or wrong shape with HTTP 200 is
  `INVALID_RESPONSE`, never an empty result.
- SAM-02: `get_opportunity` requires exactly one record whose `noticeId` matches the request (case-insensitive);
  otherwise `IDENTITY_MISMATCH`, `AMBIGUOUS_RESULT` or `INVALID_RESPONSE`.
- SAM-03: the HTTP 404 ("no data") body is cancelled instead of abandoned.
- SAM-04: `offset` is documented as GSA's zero-based page index; results report `page_index`, `page_size`,
  `returned_count`, `has_more`, `next_offset` and `partial`. No automatic paging.
- SAM-05: `engines.node` is `>=22`, consistent with the resolved dependencies (`@hono/node-server` needs 20+,
  Vitest 22.12+); CI matrix 22/24/26 with actions pinned to commit SHAs and lifecycle scripts disabled.
- Structured tool errors with codes; timeouts reported as `TIMEOUT`; upstream error excerpts labelled untrusted
  with control characters removed; every content tool warns about untrusted text.
- Key redaction also covers percent-, form- and JSON-escaped forms of the key and `api_key%3D` in links.
- Input bounds: keyword (1000 characters) and notice ID (128) limits; JSON depth/size limits on returned records.
- Lockfile regenerated: correct package name and MIT license metadata.
- Independent review fixes: an empty or short page inside `totalRecords`, error-like fields, and undocumented
  fields beside an empty page are `INVALID_RESPONSE`; `totalRecords` accepts a digit string like `limit`/`offset`;
  key redaction matches a key wrapped across lines, split by control or invisible characters, re-encoded, or
  JSON-escaped with `\u` or short escapes, and runs before excerpts are normalized and truncated; record keys
  that redact to the same name are both kept; a timeout while reading the body is `TIMEOUT`; network error text is
  labelled and sanitized; HTTP 404 after the first page reports `total: null`.
- Independent re-audit fixes (2026-10-17): a key split by any number of characters other than letters and digits
  (whitespace, punctuation, control, format, combining and other invisible characters, Hangul fillers) is removed
  (the limit was 16, and combining marks, variation selectors and fillers were not separators; SAM-REA-01,
  OM-R2-SAM-01); the separator set excludes the key's own characters, so a key containing a space or punctuation no
  longer makes matching slow (OM-R2-SAM-02); body cancellation is never awaited and body reads observe the request
  deadline, so a stalled transport cannot hold a result past the timeout (SAM-REA-02); at the page-index limit
  `has_more` stays true and the new `pagination.page_limit_reached` explains the missing `next_offset` (SAM-REA-03);
  an HTTP error whose body times out says so. `readCapped` takes an optional `AbortSignal`.
