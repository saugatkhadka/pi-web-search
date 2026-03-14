# Web Search Implementation Notes

This document records what was learned while implementing `pi-web-search`, how the current implementation works, and the main pitfalls for anyone building a similar pi package.

## Goals

- Keep the pi package small.
- Use OpenAI's built-in Responses API web search instead of a third-party crawler.
- Work with both normal OpenAI API key auth and pi's `openai-codex` login.
- Follow pi package conventions so the package installs cleanly from git.

## Current Architecture

The package registers a single pi tool, `web_search`, from `src/index.ts`.

The tool accepts a user query plus a few optional parameters:

- `allowedDomains`
- `searchContextSize`
- `externalWebAccess`
- `reasoningEffort`
- `country`, `city`, `region`, `timezone`

At runtime it:

1. Resolves which provider to use.
2. Resolves an authenticated model for that provider.
3. Builds a native OpenAI `web_search` tool payload.
4. Executes the request.
5. Extracts answer text, citations, and the consulted source list.

## Provider Resolution

Current provider selection order:

1. `PI_WEB_SEARCH_PROVIDER` if set to `openai`, `openai-codex`, or `current`
2. the current pi model when it is `openai` or `openai-codex`
3. `openai-codex`
4. `openai`

Model resolution prefers:

- the explicitly requested model from `PI_WEB_SEARCH_MODEL`
- the current model when it matches the provider
- the provider default (`gpt-5.4`)
- the first authenticated model available for that provider

This last fallback matters because pi's model registry may have auth for a provider even when the exact default model is unavailable.

## OpenAI API vs OpenAI Codex

The biggest implementation detail is that `openai` and `openai-codex` cannot currently be treated the same way.

### `openai`

Normal OpenAI API usage works with the Node SDK and the documented Responses API shape:

- `client.responses.create(...)`
- `tools: [{ type: "web_search", ... }]`
- `tool_choice: "auto"`
- `include: ["web_search_call.action.sources"]`

### `openai-codex`

pi's `openai-codex` provider points at ChatGPT's Codex backend:

- base URL: `https://chatgpt.com/backend-api`
- responses endpoint: `https://chatgpt.com/backend-api/codex/responses`

This backend needs Codex-specific request handling.

The package now sends `openai-codex` requests with `fetch()` instead of the OpenAI SDK. The current implementation uses:

- `Authorization: Bearer <token>`
- `chatgpt-account-id`
- `originator: pi`
- `OpenAI-Beta: responses=experimental`
- `accept: text/event-stream`
- `content-type: application/json`

It also sends a streaming payload and parses the SSE response manually.

## Main Bug We Hit

The original implementation returned a 400 when the extension was installed and used through `openai-codex`.

The important findings were:

- The SDK request to the Codex backend failed with `400 status code (no body)`.
- A direct `fetch()` to the same endpoint returned a usable error body.
- The backend error was: `Instructions are required`.

That means the Codex backend is stricter than the standard OpenAI Responses API path used with `OPENAI_API_KEY`.

### Fix

The `openai-codex` branch now sends:

- `instructions`
- `stream: true`
- a Responses-style `input` message array
- the native `web_search` tool payload

Once that was added, the request succeeded.

## Request Shape That Works Now

For `openai` the package sends a minimal non-streaming Responses API request through the SDK.

For `openai-codex` the package sends a minimal streaming request with these important fields:

- `model`
- `store: false`
- `stream: true`
- `instructions`
- `input`
- `tools`
- `tool_choice: "auto"`
- `include: ["web_search_call.action.sources"]`
- optional `reasoning`

The implementation intentionally keeps the query mostly unwrapped. The package sends the user's query directly instead of turning the tool into a large prompt-engineering layer.

## Why `tool_choice: "auto"`

The first implementation forced `tool_choice: "required"`.

That was unnecessary and made the request shape more opinionated than the docs and Codex examples. The current package uses `tool_choice: "auto"`, which is closer to:

- the OpenAI web search docs
- Codex request construction patterns
- the goal of keeping the tool light and model-driven

## Reasoning Notes

The first implementation also defaulted reasoning effort to `low` for every request.

This was too aggressive.

Important notes:

- OpenAI documents that web search is not supported with `gpt-5` and `minimal` reasoning.
- Not every model/provider combination should receive a reasoning block.
- Adding optional request fields when they are not needed makes compatibility worse.

The current implementation only sends `reasoning` when:

- the model looks reasoning-capable (`gpt-5`, `o1`, `o3`, `o4` families)
- the user explicitly passes `reasoningEffort`, or `PI_WEB_SEARCH_REASONING_EFFORT` is set

`minimal` is normalized to `low` before sending.

## Response Parsing Notes

Two response formats must be handled:

- standard Responses SDK objects for `openai`
- streamed SSE events for `openai-codex`

The implementation extracts:

- answer text from `response.output_text` when present
- fallback answer text from `message.content[].text`
- citations from `url_citation` annotations
- sources from `web_search_call.action.sources`

One practical detail: the Codex streaming response may not populate `output_text`, so fallback extraction from message blocks is required.

## Pitfalls

### 1. Do not assume the OpenAI SDK works unchanged against `openai-codex`

The SDK is fine for the standard OpenAI API, but ChatGPT Codex backend behavior differs enough that provider-specific handling is needed.

### 2. `openai-codex` needs `instructions`

Without `instructions`, the backend can return a 400 with:

- `Instructions are required`

### 3. Keep the tool payload simple

The package works better when it sticks close to the documented payload. Avoid turning the extension into a second agent layer.

### 4. `output_text` is not guaranteed

Especially in streamed Codex responses, the final answer may only be present inside `message.content`.

### 5. Domain filtering should use bare domains

Normalize domains before sending them. The docs expect values like:

- `openai.com`
- `docs.python.org`

not full URLs.

### 6. pi package dependencies matter

Per pi package docs, core pi packages should be declared as `peerDependencies`, not bundled as regular runtime deps.

For this package that means:

- `@mariozechner/pi-ai`
- `@mariozechner/pi-coding-agent`
- `@sinclair/typebox`

### 7. `openai-codex` auth is a JWT, not a plain API key

The implementation extracts `chatgpt_account_id` from the JWT payload to set `chatgpt-account-id`.

## Smoke Tests Used

The following checks were useful while debugging:

- `npm run check`
- direct `fetch()` calls against `https://chatgpt.com/backend-api/codex/responses`
- comparing SDK behavior versus direct fetch behavior
- inspecting final streamed `response.output` items for `web_search_call` and `message`

The most important debugging step was bypassing the SDK for `openai-codex` long enough to see the actual backend error body.

## References Used

OpenAI docs:

- `https://developers.openai.com/api/docs/guides/tools-web-search/`

pi docs:

- `packages/coding-agent/docs/packages.md`

pi source references:

- `packages/ai/src/providers/openai-codex-responses.ts`
- `packages/ai/src/providers/openai-responses.ts`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/model-registry.ts`

Codex references:

- `../codex/codex-rs/core/tests/suite/web_search.rs`
- `../codex/codex-rs/core/src/client.rs`
- `../codex/codex-rs/core/src/client_common.rs`
- `../codex/codex-rs/core/src/tools/spec_tests.rs`

Other implementation references that informed the initial approach:

- `../opencode/packages/opencode/src/tool/websearch.ts`
- `../opencode/packages/opencode/src/provider/sdk/copilot/responses/tool/web-search.ts`

## Clean-Room Guidance For Reimplementation

If reimplementing this from scratch, the shortest reliable path is:

1. Register one small pi tool.
2. Send the documented `web_search` payload for `openai`.
3. Add a separate `openai-codex` transport path.
4. Include `instructions` for Codex backend requests.
5. Parse both citations and full source lists.
6. Keep prompt shaping minimal.

That is the current approach used by this package.
