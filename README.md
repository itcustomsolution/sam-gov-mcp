# sam-gov-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Desktop, Cursor, and other MCP clients) search **SAM.gov contract opportunities** through the public [SAM.gov Get Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/).

- **Read-only.** It only searches and reads public notices.
- **Bring your own key.** You supply a free SAM.gov API key in `SAM_API_KEY`. The key is never logged and is redacted from errors and returned links.
- **No ranking or scoring.** It returns what SAM.gov returns, summarized.

## Quickstart

1. Get a free API key: sign in at [sam.gov](https://sam.gov) → Account Details → API Key.
2. Build from source (npm package coming soon):

   ```bash
   git clone https://github.com/itcustomsolution/sam-gov-mcp
   cd sam-gov-mcp && npm install && npm run build
   ```

3. Add it to your MCP client. Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "sam-gov": {
         "command": "node",
         "args": ["/absolute/path/to/sam-gov-mcp/dist/index.js"],
         "env": { "SAM_API_KEY": "your-key-here" }
       }
     }
   }
   ```

4. Ask: *"Find small-business set-aside opportunities for NAICS 541512 posted in the last 30 days in Maryland."*

## Tools

| Tool | What it does | Inputs |
|---|---|---|
| `search_opportunities` | Search notices | `posted_from`, `posted_to` (required, YYYY-MM-DD or MM/DD/YYYY, max 1-year range), `keywords` (title), `naics`, `set_aside`, `state`, `limit` (1–100, default 10), `offset` |
| `get_opportunity` | Full JSON for one notice | `notice_id` (looks back 1 year) |
| `list_set_aside_codes` | Set-aside codes and meanings | none |

Search results are summarized to: `noticeId`, `title`, `solicitationNumber`, `agency`, `postedDate`, `responseDeadline`, `type`, `setAside`, `naics`, `state`, `uiLink`.

## Scope and limits

- SAM.gov requires a posted-date range of 1 year or less on every search; the server validates this before calling the API.
- Public API keys have daily rate limits set by GSA. Errors from SAM.gov are passed back as tool errors (with the key redacted).
- Out of scope: entity/UEI lookup, award data, attachments download, bid/no-bid scoring.

## Development

```bash
npm install
npm test        # vitest, HTTP fully mocked, no key needed
npm run build
```

Never commit a real key. `.env` is git-ignored.

## License

MIT © IT Custom Solution
