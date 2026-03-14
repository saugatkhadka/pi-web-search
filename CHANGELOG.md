# Changelog

## [Unreleased]

## [0.1.0] - 2026-03-15

### Added

- Initial standalone `web_search` pi extension using OpenAI Responses web search with citations, source lists, domain filtering, location hints, and cache-only mode.
- Added implementation notes documenting provider behavior, debugging findings, and clean-room guidance for future web search implementations.

### Changed

- Simplified the request payload to match the documented Responses API web search shape more closely.

### Fixed

- Stopped forcing `tool_choice: "required"` and default reasoning on every request, which could produce 400 responses on some model/provider combinations.
- Switched `openai-codex` requests to the provider-native streaming payload with required instructions, which fixes 400 responses from the ChatGPT Codex backend.
- Declared pi core packages as peer dependencies so the package follows pi package conventions.
