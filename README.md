# sam-gov-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Desktop, Cursor, and other MCP clients) search **SAM.gov contract opportunities** through the public [SAM.gov Get Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/).

- **Read-only.** It only searches and reads public notices.
- **Bring your own key.** You supply a free SAM.gov API key in `SAM_API_KEY`. The key is never logged and is redacted from errors and returned links.
- **No ranking or scoring.** It returns what SAM.gov returns, summarized.
- **Fails loudly.** A response that does not match the documented format, or a notice lookup that returns a
  different or ambiguous record, is a tool error, never an empty or unrelated "success".

Requires Node.js 22 or later.

## Quickstart

1. Get a free API key: sign in at [sam.gov](https://sam.gov) → Account Details → API Key.
2. Install. Claude Code:

   ```bash
   claude mcp add sam-gov -e SAM_API_KEY=your-key-here -- npx -y @itcustomsolution/sam-gov-mcp
   ```

   Or run it directly: `SAM_API_KEY=your-key-here npx -y @itcustomsolution/sam-gov-mcp`

3. Add it to your MCP client. Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "sam-gov": {
         "command": "npx",
         "args": ["-y", "@itcustomsolution/sam-gov-mcp"],
         "env": { "SAM_API_KEY": "your-key-here" }
       }
     }
   }
   ```

4. Ask: *"Find small-business set-aside opportunities for NAICS 541512 posted in the last 30 days in Maryland."*

## Tools

| Tool | What it does | Inputs |
|---|---|---|
| `search_opportunities` | Search notices, one page per call | `posted_from`, `posted_to` (optional, default last 30 days; YYYY-MM-DD or MM/DD/YYYY, max 1-year range), `keywords` (title), `naics`, `set_aside`, `state`, `limit` (1-100 records per page, default 10), `offset` (zero-based **page index**, default 0) |
| `get_opportunity` | The notice record for one notice, as the search API returns it | `notice_id` (looks back 1 year) |
| `list_set_aside_codes` | Set-aside codes and meanings | none |

Search results are summarized to: `noticeId`, `title`, `solicitationNumber`, `agency`, `postedDate`, `responseDeadline`, `type`, `setAside`, `naics`, `state`, `uiLink`.

### Pages

Per the GSA documentation, `offset` is a page index, not a record offset: page *N* holds records
*N* x `limit` to *N* x `limit` + `limit` - 1. Each search returns one page and never fetches more on its
own. The result's `pagination` object says where you are: `page_index`, `page_size`, `returned_count`,
`has_more`, `next_offset` (pass it back as `offset`, or `null` when there is no next page), `partial`
(true unless this single page holds every matching record) and `page_limit_reached` (true when more records
exist but the next page index would exceed 1,000,000; narrow the search or use a larger page size). `total` is SAM.gov's `totalRecords`; it is `null`
when a page after the first returns HTTP 404, because that reply does not say how many records exist.

### Errors

Tool errors are JSON: `{"error": {"code", "message", "status"?}}` with `isError: true`. Codes:
`MISSING_CONFIGURATION`, `INVALID_INPUT`, `NETWORK_ERROR`, `TIMEOUT`, `UPSTREAM_HTTP_ERROR`,
`RESPONSE_TOO_LARGE`, `RESPONSE_TOO_COMPLEX` (checking the reply for the key would exceed the limits below; nothing
of it is returned), `INVALID_RESPONSE`, `NOT_FOUND`, `AMBIGUOUS_RESULT` (more than one record for one notice
ID), `IDENTITY_MISMATCH` (a record for a different notice ID), `CANCELLED` (the MCP client cancelled the call) and
`INTERNAL_ERROR` (an unexpected failure inside this server). A `TIMEOUT` message says which step did not finish:
the request, reading the body, or checking the reply. Arguments that fail the tool's input schema (for example `limit: 0`) are rejected by the MCP SDK
before this server runs, as plain text, not JSON. HTTP 404 means "no data" per GSA and is an empty result; its
body is released, not read. Observed against the live service on 2026-10-22: an unrecognized `SAM_API_KEY` is also
answered with an empty HTTP 404, so a wrong key looks like zero results (`total` 0) rather than an error, while a
genuinely empty search returns HTTP 200 with `totalRecords: 0`. If every search returns nothing, check the key first.

`INVALID_RESPONSE` means the body does not match the documented success format: an error-like field (`error`,
`message`, `status`, `fault`, `warning` in any form) or any undocumented top-level field beside an empty page,
`totalRecords`/`limit`/`offset` that are not integers or do not match the request, a page that is not full
before the last page or not the remainder on the last page, or a record without a valid `noticeId` or with a
summary field of the wrong type. One malformed record fails the whole page. The checks follow GSA's documented
examples and this project's mocked tests. On 2026-10-22 they were exercised once against the live service with a
real key (two consecutive five-record pages, a 100-record page, one notice lookup, an unknown notice ID, an
out-of-range page index and an invalid key); every reply parsed and no reply echoed the key. That is one day's
sample, not continuous coverage, so a live reply that GSA formats differently may still be refused.

## Scope and limits

- SAM.gov requires a posted-date range of 1 year or less on every search; the server validates this before calling the API.
- Public API keys have daily rate limits set by GSA. This server does not rate-limit or queue calls itself; every
  tool call is one SAM.gov request. Errors from SAM.gov are passed back as tool errors (with the key redacted).
- Out of scope: entity/UEI lookup, award data, attachments download, bid/no-bid scoring.

### Resource limits

- One deadline per tool call (30 s by default) and the MCP client's cancellation cover the request, reading the
  body (at most 5 MB), JSON parsing, the format checks and the key check. Everything after the body is read runs
  in a worker thread, which is stopped (`terminate`) when the deadline passes or the call is cancelled, so a reply
  that keeps the check busy can neither hold the call past its deadline nor stop the server answering other
  requests. The result is `TIMEOUT` or `CANCELLED`, with nothing returned.
- The worker's V8 heap is limited to 256 MB (old generation, plus 32 MB young generation); a check that needs more
  is `RESPONSE_TOO_COMPLEX`. At most 2 checks run at once in one process, counted until each worker thread has exited
  (a thread held in native code keeps its slot until it exits); another waits its turn under its own deadline
  (`TIMEOUT`, "did not start"). This bounds the workers' JavaScript heap, not the whole process: the main
  thread, buffers and code use memory beyond it.
- Before the key check, every string (values and property names) is measured: one whose NFKC form is more than
  4 times its length plus 256, or all of them together growing more than 2 times plus 65,536, refuses the reply
  (`RESPONSE_TOO_COMPLEX`); so do the JSON depth and node limits (`INVALID_RESPONSE`). No expanded copy is made to
  measure this, and a decoding round that would exceed the same growth limit refuses the reply too.
- The key check has a fixed work budget: 48 units per character of all strings it checks, plus 1,000,000, where
  a unit is one character examined by any reading of any string (including the joined readings), an escape decoded
  costs 32 and each string costs 16 more. For a search, the strings checked are the summaries returned, not every
  field of the reply; the whole reply is still parsed and format-checked in the worker. Running out refuses the reply (`RESPONSE_TOO_COMPLEX`); it is never returned partly redacted,
  and redaction coverage is not reduced to stay within the budget. The budget does not depend on the machine.
- Measured for this release on macOS (Apple M3 Ultra, Node 22.23.2) at 64 to 256 KB per reply: ordinary replies
  need about 19 to 21 units per character, text made of percent-encoded URLs 44, the same URLs one per line 65 (refused,
  because a string with control characters is read a third time), text with literal `\u` sequences 39, and the crafted shapes recorded for the previous release 60 to 121, which are refused
  (the two NFKC-expansion shapes are refused before any scan). Text made only of `%XX` escapes needs about 58 and is
  refused too, which is safe but costs availability. A unit took
  about 9 to 12 ns in the builder's runs and 3.3 to 17 ns in the internal reviewer's, so a 5 MB reply at the full
  budget would take about 1 to 4.5 s; that was not measured at 5 MB.
  These limits were not calibrated against live SAM.gov replies: an unusual live reply could be refused, which is
  safe but costs availability. `SamGovClient` takes `{ limits }` to change them.
- `redactDeep`, used directly as a library function, applies the same limits but runs in the calling thread, where
  they bound the work, not the time. Upstream error bodies (at most 16 KB) and network error text (cut to 16 KB) are
  redacted in the main thread; that is bounded by their size (about 15 ms measured at 16 KB), not by the deadline.

## Security notes

- SAM.gov requires the key as an `api_key` query parameter, so it travels in the request URL to `api.sam.gov` over HTTPS. The server removes it from errors, links and returned JSON: any `api_key=` value, and, for keys of 8 or more characters, the key itself written literally, percent-encoded (either hex case, also repeated) or JSON-escaped, including when any number of separators are inserted between its characters. A separator is any character that is not a letter or number (Unicode categories L and N), not `%` or `\`, and not one of the key's own characters: line breaks, spaces, other punctuation, control, format, combining and other invisible characters, and Hangul fillers. After that, as a fail-closed check, every string is read in every way its escapes can be taken: each percent-encoded byte (a multi-byte UTF-8 sequence counts as one), JSON `\u` escape, JSON short escape (`\n`, `\t`, `\b`, `\f`, `\r`, `\/`, `\\`, `\"`, lowercase only, as JSON writes them) and HTML numeric entity (read whole however many leading zeros it has, with or without `;`) either as written or decoded, independently of the others; named entities dropped, except the double-struck, script and fraktur letters such as `&Sopf;` and the escape characters `&amp;`, `&num;`, `&percnt;`, `&bsol;` and `&semi;`, which are decoded; NFKC applied, which folds fullwidth and other compatibility forms, also of `%`, `\`, `&` and `#`; round after round until nothing changes (each round decodes repeated encodings of `%`, then percent-encoding, `\u` escapes, numeric and then named entities); and the same again after removing, before each round, every character other than an ASCII letter, a digit, `%`, `\`, `&`, `#` and `;`, so a character inserted inside an escape cannot stop it decoding. Each reading is reduced to its ASCII letters and digits after decomposition (NFKD), so a letter followed by a combining mark counts as the letter; in the readings with inserted characters removed, combining marks are removed before NFKC, so a mark after an escape's last digit (`%4e` + U+0301) does not stop it decoding, while a precomposed letter (`é`) stays one character and is removed. A control character or a lone surrogate, which JSON writes as an escape (`\b`, `\n`, `\u0001`, `\udc00`), is read both as a separator and as the letters of that escape, also in a third reading, made only for strings that contain one, that removes the other inserted characters but keeps control characters. Where a record has an integer-like property name, which JSON writes first, all strings, the values alone and the names alone are also read in the order JSON writes them. Not covered: a lone high surrogate at the end of one string and a lone low surrogate at the start of the next, which pair up when strings are read together. If the key's letters and digits appear in any reading, a reading still decodes further after 8 rounds, or the string holds a numeric entity beyond U+10FFFF (one joined up only by removing inserted characters does not count), the whole string is replaced by `REDACTED`; if they appear only when neighbouring strings are read together (a value and the next value, a property name and its value, nested property names), including when the split falls inside an escape (`%5` then `3...`, `%25` then `53...`, `&amp;#8` then `3;...`, a fullwidth `％` then `53...`), the response is refused as `INVALID_RESPONSE`: after every string is redacted, all strings in order, the values alone and the property names alone are each read again joined end to end, in every reading above, and a numeric entity beyond U+10FFFF that only the joining forms is dropped there instead of refusing. A joined reading that still decodes after 8 rounds refuses the response too, and a property name that gets a numeric suffix after a collision is read with its suffix. The check follows every reading at once with a small automaton, so its cost stays linear in the text. The joined readings add at least two passes over a response, and every further decoding round of the joined text is another pass; that work is bounded as described under Resource limits, and a reply that needs more is refused, never partly returned. This covers `%`, `\` or the key's own punctuation used as separators, a `%` written before two of the key's hex digits, separators inside an encoded character or themselves encoded (`%0A`, `\u200b`, a zero-width space or a non-ASCII letter inside `%53` or `\u0053`), a mix of encoded characters and escapes left as text (`%35%67` with only `%35` decoded, `%25` before two of the key's digits, `&amp;#83;`), fullwidth letters and escape characters, and HTML entities, also with leading zeros. Text that happens to contain the key's letters and digits in order is blanked too, as is a string that still decodes after 8 rounds, for example a run of more than 256 literal backslashes. Not recognized: ASCII letters or digits used as separators (other letters, including U+0345 which case-folds to one, are dropped by this check), `%`, `\`, `&`, `#` or `;` written inside an escape, a key in which a character is encoded more than once while an escape elsewhere in it is left as text (also when such a key is split across fields), other named entities, look-alike characters from other scripts that replace the key's own characters, a key split across fields that are not next to each other or into numbers, and other encodings such as base64. These are the transformations the check recognizes, not protection against every way an upstream could encode the key. Short keys get less: keys shorter than 8 characters get only the `api_key=` value removed (the key written anywhere else is left as it is), and keys of 8 or more characters with fewer than 8 ASCII letters and digits get the literal and encoded pattern but not the decoded check. Error excerpts are redacted before and after they are cut to 300 characters. The server refuses a key that is not 1 to 256 printable ASCII characters other than spaces, `%` and `\`, or that looks like the redaction marker (its letters and digits contain `redacted` or occur inside `api_key=REDACTED`), without echoing it. Each call has one deadline (30 seconds by default) that covers the request, the body, parsing and the key check, and also holds when a custom `fetchImpl` ignores the abort signal. Anything that logs full URLs (an HTTP proxy, for example) would see the key.
- Notice text, links and upstream error text are third-party content. Every result carries a `source` note saying
  so, upstream and network error excerpts are labelled `[untrusted upstream text]` with control, bidirectional
  and invisible formatting characters removed, and both content tools say it in their
  descriptions. Treat all of it as data, not instructions (prompt injection); this server does not and cannot
  make a model resistant to it.
- Responses over 5 MB are refused. Each call has a 30 s deadline that covers the request, reading the response
  body and checking it (see Resource limits); cleanup of an unused body is started but never waited for. An HTTP error status that arrived before the deadline is
  reported as `UPSTREAM_HTTP_ERROR`, with a note if its body could not be read in time.

## Development

```bash
npm ci --ignore-scripts
npm run build
npm test        # vitest, HTTP fully mocked, no key needed
```

Development needs Node.js 22.12 or later (Vitest 5). The tests run the check worker from the TypeScript source, which
needs Node's built-in type stripping (on by default in Node 22.23.2 and 26.7.0, the versions tested); the published
package runs compiled JavaScript.

Never commit a real key. `.env` is git-ignored.

## License

MIT © IT Custom Solution
