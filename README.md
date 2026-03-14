# pi-web-search

Standalone pi package that adds a small `web_search` tool backed by OpenAI's built-in Responses API web search.

## Install

```bash
pi install git:github.com/saugatkhadka/pi-web-search
```

Then enable the extension in `pi config` if needed.

## Auth

The extension works with either:

- `openai-codex` auth from pi `/login`
- `OPENAI_API_KEY`

It prefers the current model when that model uses `openai` or `openai-codex`, then falls back to the first authenticated OpenAI provider it can use.

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
- `reasoningEffort?`: optional reasoning effort for reasoning-capable models
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
- `PI_WEB_SEARCH_REASONING_EFFORT`: optional default effort when you want reasoning-capable models to search more deeply

Defaults:

- provider: current OpenAI/OpenAI Codex model, else `openai-codex`, else `openai`
- model: current model if it matches, else the provider default or first authenticated model

## Notes

- The extension uses OpenAI's native web search tool, not a third-party crawler.
- `externalWebAccess: false` requests cache-only behavior.
- The tool sends the user's query directly to the model and keeps request shaping minimal.
- Implementation notes: `docs/web-search-implementation.md`
- The package is designed for git-based installation through pi.

## Development

```bash
npm install
npm run check
```
