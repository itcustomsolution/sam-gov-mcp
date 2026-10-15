# sam-gov-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Desktop, Cursor, and other MCP clients) search **SAM.gov contract opportunities** through the public [SAM.gov Get Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/).

- **Read-only.** It only searches and reads public notices.
- **Bring your own key.** You supply a free SAM.gov API key in `SAM_API_KEY`. The key is never logged and is redacted from errors and returned links.
- **No ranking or scoring.** It returns what SAM.gov returns, summarized.

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
| `search_opportunities` | Search notices | `posted_from`, `posted_to` (optional, default last 30 days; YYYY-MM-DD or MM/DD/YYYY, max 1-year range), `keywords` (title), `naics`, `set_aside`, `state`, `limit` (1–100, default 10), `offset` |
| `get_opportunity` | Full JSON for one notice | `notice_id` (looks back 1 year) |
| `list_set_aside_codes` | Set-aside codes and meanings | none |

Search results are summarized to: `noticeId`, `title`, `solicitationNumber`, `agency`, `postedDate`, `responseDeadline`, `type`, `setAside`, `naics`, `state`, `uiLink`.

## Scope and limits

- SAM.gov requires a posted-date range of 1 year or less on every search; the server validates this before calling the API.
- Public API keys have daily rate limits set by GSA. Errors from SAM.gov are passed back as tool errors (with the key redacted).
- Out of scope: entity/UEI lookup, award data, attachments download, bid/no-bid scoring.

## Security notes

- SAM.gov requires the key as an `api_key` query parameter, so it travels in the request URL to `api.sam.gov` over HTTPS. The server redacts it from errors, links, and returned JSON, but anything that logs full URLs (an HTTP proxy, for example) would see it.
- Notice titles and descriptions are third-party text. Treat them as data, not instructions (prompt injection).
- Responses over 5 MB are refused and requests time out after 30 s.

## Development

```bash
npm install
npm test        # vitest, HTTP fully mocked, no key needed
npm run build
```

Never commit a real key. `.env` is git-ignored.

## License

MIT © IT Custom Solution
