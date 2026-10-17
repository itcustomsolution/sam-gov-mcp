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
`RESPONSE_TOO_LARGE`, `INVALID_RESPONSE`, `NOT_FOUND`, `AMBIGUOUS_RESULT` (more than one record for one notice
ID), `IDENTITY_MISMATCH` (a record for a different notice ID) and `INTERNAL_ERROR` (an unexpected failure inside
this server). Arguments that fail the tool's input schema (for example `limit: 0`) are rejected by the MCP SDK
before this server runs, as plain text, not JSON. HTTP 404 means "no data" per GSA and is an empty result; its
body is released, not read.

`INVALID_RESPONSE` means the body does not match the documented success format: an error-like field (`error`,
`message`, `status`, `fault`, `warning` in any form) or any undocumented top-level field beside an empty page,
`totalRecords`/`limit`/`offset` that are not integers or do not match the request, a page that is not full
before the last page or not the remainder on the last page, or a record without a valid `noticeId` or with a
summary field of the wrong type. One malformed record fails the whole page. The checks follow GSA's documented
examples and this project's mocked tests. They have not been run against the live SAM.gov service in this
release, so a live reply that GSA formats differently may be refused.

## Scope and limits

- SAM.gov requires a posted-date range of 1 year or less on every search; the server validates this before calling the API.
- Public API keys have daily rate limits set by GSA. This server does not rate-limit or queue calls itself; every
  tool call is one SAM.gov request. Errors from SAM.gov are passed back as tool errors (with the key redacted).
- Out of scope: entity/UEI lookup, award data, attachments download, bid/no-bid scoring.

## Security notes

- SAM.gov requires the key as an `api_key` query parameter, so it travels in the request URL to `api.sam.gov` over HTTPS. The server removes it from errors, links and returned JSON: any `api_key=` value, and, for keys of 8 or more characters, the key itself written literally, percent-encoded (either hex case, also repeated) or JSON-escaped, including when any number of separators are inserted between its characters. A separator is any character that is not a letter or number (Unicode categories L and N), not `%` or `\`, and not one of the key's own characters: line breaks, spaces, other punctuation, control, format, combining and other invisible characters, and Hangul fillers. After that, as a fail-closed check, every string is read in every way its escapes can be taken: each percent-encoded byte (a multi-byte UTF-8 sequence counts as one), JSON `\u` escape and HTML numeric entity (read whole however many leading zeros it has, with or without `;`) either as written or decoded, independently of the others; named entities dropped, except the double-struck, script and fraktur letters such as `&Sopf;` and the escape characters `&amp;`, `&num;`, `&percnt;`, `&bsol;` and `&semi;`, which are decoded; NFKC applied, which folds fullwidth and other compatibility forms, also of `%`, `\`, `&` and `#`; round after round until nothing changes (each round decodes repeated encodings of `%`, then percent-encoding, `\u` escapes, numeric and then named entities); and the same again after removing, before each round, every character other than an ASCII letter, a digit, `%`, `\`, `&`, `#` and `;`, so a character inserted inside an escape cannot stop it decoding. Each reading is reduced to its ASCII letters and digits. If the key's letters and digits appear in any reading, a reading still decodes further after 8 rounds, or the string holds a numeric entity beyond U+10FFFF (one joined up only by removing inserted characters does not count), the whole string is replaced by `REDACTED`; if they appear only when neighbouring strings are read together (a value and the next value, a property name and its value, nested property names), including when the split falls inside an escape (`%5` then `3...`, `%25` then `53...`, `&amp;#8` then `3;...`, a fullwidth `％` then `53...`), the response is refused as `INVALID_RESPONSE`: after every string is redacted, all strings in order, the values alone and the property names alone are each read again joined end to end, in every reading above, and a numeric entity beyond U+10FFFF that only the joining forms is dropped there instead of refusing. A joined reading that still decodes after 8 rounds refuses the response too, and a property name that gets a numeric suffix after a collision is read with its suffix. The check follows every reading at once with a small automaton, so its cost stays linear in the text. The joined readings add at least two passes over a response, and every further decoding round of the joined text is another pass: a crafted 5 MB response can take several seconds and about 1 GB of memory to check. This covers `%`, `\` or the key's own punctuation used as separators, a `%` written before two of the key's hex digits, separators inside an encoded character or themselves encoded (`%0A`, `\u200b`, a zero-width space or a non-ASCII letter inside `%53` or `\u0053`), a mix of encoded characters and escapes left as text (`%35%67` with only `%35` decoded, `%25` before two of the key's digits, `&amp;#83;`), fullwidth letters and escape characters, and HTML entities, also with leading zeros. Text that happens to contain the key's letters and digits in order is blanked too. Not recognized: ASCII letters or digits used as separators (other letters, including U+0345 which case-folds to one, are dropped by this check), `%`, `\`, `&`, `#` or `;` written inside an escape, a key in which a character is encoded more than once while an escape elsewhere in it is left as text (also when such a key is split across fields), other named entities, look-alike characters from other scripts that replace the key's own characters, a key split across fields that are not next to each other or into numbers, and other encodings such as base64. These are the transformations the check recognizes, not protection against every way an upstream could encode the key. Short keys get less: keys shorter than 8 characters get only the `api_key=` value removed (the key written anywhere else is left as it is), and keys of 8 or more characters with fewer than 8 ASCII letters and digits get the literal and encoded pattern but not the decoded check. Error excerpts are redacted before and after they are cut to 300 characters. The server refuses a key that is not 1 to 256 printable ASCII characters other than spaces, `%` and `\`, or that looks like the redaction marker (its letters and digits contain `redacted` or occur inside `api_key=REDACTED`), without echoing it. Each request has one deadline (30 seconds by default) that also holds when a custom `fetchImpl` ignores the abort signal. Anything that logs full URLs (an HTTP proxy, for example) would see the key.
- Notice text, links and upstream error text are third-party content. Every result carries a `source` note saying
  so, upstream and network error excerpts are labelled `[untrusted upstream text]` with control, bidirectional
  and invisible formatting characters removed, and both content tools say it in their
  descriptions. Treat all of it as data, not instructions (prompt injection); this server does not and cannot
  make a model resistant to it.
- Responses over 5 MB are refused. Each request has a 30 s deadline that covers reading the response body; cleanup
  of an unused body is started but never waited for. An HTTP error status that arrived before the deadline is
  reported as `UPSTREAM_HTTP_ERROR`, with a note if its body could not be read in time.

## Development

```bash
npm ci --ignore-scripts
npm run build
npm test        # vitest, HTTP fully mocked, no key needed
```

Development needs Node.js 22.12 or later (Vitest 5).

Never commit a real key. `.env` is git-ignored.

## License

MIT © IT Custom Solution
