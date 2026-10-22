# Changelog

## [0.2.0] - 2026-10-22

- Independent release review (2026-10-22), SAM-01: the key check also reads JSON short escapes (`\n`, `\t`, `\/`,
  `\\`, `\"`) as escapes, written or decoded, so a key split by a literal backslash-and-letter in a value or an
  error body is redacted.
- SAM-02: reading a response body is bounded by chunk count (65,536) as well as bytes, yields to the event loop every
  256 chunks so the deadline can fire on an endless stream of tiny chunks, and keeps one abort listener for the whole
  read instead of one reaction per chunk.
- SAM-03: a call whose cancellation signal is already aborted does not invoke the transport at all.
- Re-review of the fixes (SAM-04 to SAM-06): an abort that lands during the periodic yield is seen before the next
  read starts; the chunk bound counts data chunks only, not the end of the stream; two-character short escapes are
  not charged the per-escape work unit, so a value made of many of them is still returned. A string that still
  decodes after 8 rounds (more than 256 literal backslashes) is blanked; README says so.
- Live check (2026-10-22, real key, one day's sample): consecutive pages, a 100-record page, a notice lookup, an
  unknown notice and an out-of-range page parsed as documented; no reply echoed the key. Observed: an unrecognized
  key is answered with an empty HTTP 404, which this server reports as an empty result; README says so.

### 0.2.0-rc.6 (2026-10-17, candidate)

- R5-SAM-RES: checking a reply for the API key is bounded and stoppable. Everything after the body is read
  (JSON parsing, format checks, transformation-aware redaction) runs in a worker thread with a 256 MB heap limit
  that is terminated at the call's deadline or on cancellation; the deadline now covers the whole call. Before the
  check, each string's NFKC growth is limited (4 times plus 256, all strings 2 times plus 65,536); the check itself
  has a deterministic work budget (48 units per character plus 1,000,000; 32 per escape). Exceeding a limit is the
  new `RESPONSE_TOO_COMPLEX`; nothing of the reply is returned. Redaction coverage is unchanged.
- Cancellation: `search` and `getOpportunity` take `{ signal }`, the MCP tools pass the client's cancellation, and
  a cancelled call is the new `CANCELLED`.
- `SamGovClient` takes a fifth argument `{ limits, workerUrl }`; `redactDeep` takes `limits`; `checkReply` and
  `CHECK_LIMITS` are exported.
- Internal security review fixes (round 1): a key written with control characters for letters (shown as `\b`, `\f`
  in the output) is caught (also present in rc.5); network error text is cut to 16 KB before it is redacted in the main thread; each string costs a fixed 16
  units; at most 2 checks run at once.
- Internal security review fixes (round 2): the scan reads letters after decomposition (NFKD) so a combining mark
  after a letter no longer hides it (also in rc.5; completed in the review of the final delta); a control character or lone surrogate is read in the same pass both as a separator
  and as the letters JSON writes for it, replacing round 1's second scan and its extra cost; a record with an
  integer-like property name is also read in JSON's output order; a check's slot is held until its thread exits.
- Internal security review of the final delta: the reading with inserted characters removed deleted control
  characters before they could be read as JSON escape letters (927 of 3,000 fuzzed strings that 4256cfb caught were
  returned); a third reading keeps them. NFKC no longer merges a combining mark into an escape's last digit in the
  stripped readings. The output-order reading covers values alone and names alone. On a 3,000-string differential fuzz
  nothing 4256cfb caught is lost; on 3,600 encoded-key inputs 3,439 results equal rc.5's and 161 redact more, none is
  refused. Newline-separated lists of percent-encoded URLs now exceed the default budget and are refused.
- `server.json` (MCP registry metadata) had stayed at 0.2.0-rc.2 through rc.3 to rc.5; it now matches the package
  version, and a test keeps them equal.
- Previously measured (r5, crafted 5 MB replies): about 10 s of CPU or about 1 GB of memory. Those shapes, scaled to
  64 to 256 KB, are now refused within the budget; no 5 MB measurement was made for this candidate.

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
  read across the boundary however long the padding, the crafted responses that made r5 slow (6 to 7 s) take 67 to 89 ms
  again, as on r4, and one shape 287 ms, about twice r4's time, and a numeric entity beyond U+10FFFF formed only by the joining is dropped
  there instead of refusing the response. The carried state of r4 stays, for keys whose parts are encoded to different
  depths. A joined reading that still decodes after 8 rounds refuses the response, and each further round of the joined
  text is another pass over it (README). After the second review round, a property name that gets a numeric suffix
  after a collision is read with its suffix, so the suffix cannot complete the key with the next value (OM-R5B-SAM-05,
  present since r4).
