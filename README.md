# pi-web-search

Standalone pi extension package that adds a `web_search` tool powered by OpenAI's built-in Responses API web search.

## Install

```bash
pi install git:github.com/saugatkhadka/pi-web-search
```

Then enable the extension in `pi config` if needed.

## Auth

The extension works with either:

- `openai-codex` auth from pi `/login`
- `OPENAI_API_KEY`

It prefers the current model when that model uses `openai` or `openai-codex`, then falls back to `openai-codex`, then `openai`.

## What it adds

- `web_search` tool for current or fast-changing information
- OpenAI Responses `web_search` support with:
  - domain allow-lists
  - search context size (`low`, `medium`, `high`)
  - approximate user location
  - live internet or cache-only mode
  - extracted citations and consulted sources

## Tool

The extension registers:

- `web_search`

Parameters:

- `query`: search request
- `allowedDomains?`: optional domain allow-list like `openai.com`
- `searchContextSize?`: `low`, `medium`, `high`
- `externalWebAccess?`: `true` for live fetches, `false` for cache-only mode
- `reasoningEffort?`: `minimal`, `low`, `medium`, `high`
- `country?`, `city?`, `region?`, `timezone?`: optional approximate user location hints

Example prompt inside pi:

```text
Find the latest OpenAI Responses API web search docs updates and cite official sources.
```

The tool returns:

- the answer text
- a source list
- structured details including citations and consulted sources

## Optional environment variables

- `PI_WEB_SEARCH_PROVIDER`: `current`, `openai`, or `openai-codex`
- `PI_WEB_SEARCH_MODEL`: override the search model
- `PI_WEB_SEARCH_REASONING_EFFORT`: default effort when omitted in tool args

Defaults:

- provider: current OpenAI/OpenAI Codex model, else `openai-codex`, else `openai`
- model: current model if it matches, else `gpt-5.4`
- reasoning effort: `low`

## Notes

- The extension uses OpenAI's native web search tool, not a third-party crawler.
- `externalWebAccess: false` requests cache-only behavior.
- The package is designed for git-based installation through pi.

## Development

```bash
npm install
npm run check
```
