# Changelog

## [0.2.0-rc.5] - unreleased candidate (2026-10-17, not published; 0.2.0-rc.1 of 2026-10-16 and 0.2.0-rc.2 to 0.2.0-rc.4 of 2026-10-17 were the independently audited candidates)

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
  longer makes matching slow (OM-R2-SAM-02); the client refuses a key that is not 1 to 256 printable ASCII
  characters other than spaces, `%` and `\` (a key with whitespace is refused rather than redacted, and `%` or `\`
  in a key made matching ambiguous and, for long runs of backslashes, exponential; OM-R2C-SAM-01), and no pattern is ever built from such a key, so an over-long key can no longer surface
  in a RegExp error (OM-R2B-SAM-02); the README names `%`, `\` and the key's own punctuation as not recognized
  separators (OM-R2B-SAM-01); body cancellation is never awaited and body reads observe the request
  deadline, so a stalled transport cannot hold a result past the timeout (SAM-REA-02); at the page-index limit
  `has_more` stays true and the new `pagination.page_limit_reached` explains the missing `next_offset` (SAM-REA-03);
  an HTTP error whose body times out says so. `readCapped` takes an optional `AbortSignal`.
- r2 audit fixes (2026-10-17): the request deadline also holds against a custom `fetchImpl` that ignores the abort
  signal; a late reply is `TIMEOUT` and its body is released unread (R2-SAM-01); a key that looks like the redaction
  marker is refused (R2-SAM-02). Before release (pre-existing): after pattern redaction, any string whose decoded
  letters and digits contain the key's is replaced whole, and a key split across neighbouring fields refuses the
  response, so `%`, `\`, the key's own punctuation, encoded separators, fullwidth letters and HTML entities no longer
  leave the key recoverable. `lettersAndDigits` and `markerLike` are exported.
- r3 review fixes (omar, 2026-10-17): a late reply whose body has no working `cancel` no longer crashes the process
  with an unhandled rejection (OM-R3-SAM-01, introduced by the R2-SAM-01 fix); a key split between a property name
  and its value or across nested names refuses the response (OM-R3-SAM-02); decoding runs to a fixpoint and text that
  still decodes after 8 rounds is blanked, so deeper nested encodings are covered (OM-R3-SAM-03); many property names
  that redact to the same name are handled in linear time (OM-R3-SAM-04, pre-existing). `lettersAndDigits` returns
  `undefined` for text that does not settle; `MAX_DECODE_ROUNDS` is exported.
  After the second review round: a reply whose `body` getter throws is released quietly too (OM-R3B-SAM-01).
- r3 audit fixes (2026-10-17): every string is read in every way its escapes can be taken (each escape as written or
  decoded one step, independently, round after round with NFKC, and again with inserted characters removed) by a
  linear automaton, and blanked if the key's letters and digits appear in any reading. So a numeric entity padded
  with leading zeros, a zero-width character inside a percent or `\u` escape, a `%` written before two of the key's
  hex digits (R3-SAM-01), and a mix of these with escapes left as text, down to single percent bytes
  (OM-R4-SAM-01, OM-R4B-SAM-01) no longer leave the key recoverable. `&amp;`, `&num;`, `&percnt;`, `&bsol;` and
  `&semi;` are decoded. Numeric entities are read whole; one beyond U+10FFFF blanks the string. The split-field check carries
  the automaton's state between neighbouring strings. Error excerpts are redacted before and after they are cut, so
  the cut cannot complete the key (OM-R4-SAM-02). README states the short-key policy exactly (R3-SAM-02) and lists
  what is still not recognized.
- r4 audit fix (2026-10-17): an escape that one string leaves open and the next completes ("%5" then "3...") is read
  across the boundary, so a key split that way across neighbouring fields refuses the response (R4-SAM-1). README
  states that the recognized transformations are not protection against every encoding. After the internal r5 review
  (OM-R5-SAM-01..04) the boundary is no longer found by matching an open escape in the raw text: all strings in order,
  the values alone and the property names alone are each read again joined end to end, once, after redaction, so an
  escape that decodes to an opener ("%25", "&amp;"), a fullwidth opener and an opener with a character inserted are
  read across the boundary however long the padding, the crafted responses that made r5 slow cost what they did on r4,
  and a numeric entity beyond U+10FFFF formed only by the joining is dropped there instead of refusing the response.
  The carried state of r4 stays, for keys whose parts are encoded to different depths.
