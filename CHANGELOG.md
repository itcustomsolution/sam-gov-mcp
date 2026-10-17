# Changelog

## [0.2.0-rc.1] - unreleased candidate (2026-10-16, not published)

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
