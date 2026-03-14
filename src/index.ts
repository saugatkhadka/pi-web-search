import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import OpenAI from "openai";
import type { WebSearchTool } from "openai/resources/responses/responses.js";

type SupportedProvider = "openai" | "openai-codex";
type SearchContextSize = "low" | "medium" | "high";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

interface SearchCitation {
	title?: string;
	url: string;
	startIndex?: number;
	endIndex?: number;
}

interface SearchSource {
	title?: string;
	url: string;
	type?: string;
}

interface WebSearchDetails {
	provider: SupportedProvider;
	model: string;
	query: string;
	externalWebAccess: boolean;
	searchContextSize?: SearchContextSize;
	allowedDomains?: string[];
	userLocation?: {
		country?: string;
		city?: string;
		region?: string;
		timezone?: string;
	};
	citations: SearchCitation[];
	sources: SearchSource[];
	responseId?: string;
}

interface SearchClientConfig {
	provider: SupportedProvider;
	modelId: string;
	apiKey: string;
	baseUrl: string;
	headers?: Record<string, string>;
}

type ExtendedWebSearchTool = WebSearchTool & { external_web_access?: boolean };

type RecordValue = Record<string, unknown>;

const DEFAULT_MODEL_BY_PROVIDER: Record<SupportedProvider, string> = {
	openai: "gpt-5.4",
	"openai-codex": "gpt-5.4",
};

const SUPPORTED_PROVIDERS: SupportedProvider[] = ["openai-codex", "openai"];

const WebSearchParametersSchema = Type.Object({
	query: Type.String({ minLength: 1, description: "What to search for on the web." }),
	allowedDomains: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			maxItems: 100,
			description: "Optional allow-list of domains such as openai.com or docs.python.org.",
		}),
	),
	searchContextSize: Type.Optional(
		Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
	),
	externalWebAccess: Type.Optional(
		Type.Boolean({ description: "Set false to use cache-only search without live internet fetches." }),
	),
	reasoningEffort: Type.Optional(
		Type.Union([
			Type.Literal("minimal"),
			Type.Literal("low"),
			Type.Literal("medium"),
			Type.Literal("high"),
		]),
	),
	country: Type.Optional(
		Type.String({ minLength: 2, description: "Optional two-letter ISO country code for location-aware results." }),
	),
	city: Type.Optional(Type.String({ minLength: 1, description: "Optional city hint for local results." })),
	region: Type.Optional(Type.String({ minLength: 1, description: "Optional region/state hint for local results." })),
	timezone: Type.Optional(
		Type.String({ minLength: 1, description: "Optional IANA timezone such as America/Chicago." }),
	),
});

type WebSearchParameters = Static<typeof WebSearchParametersSchema>;

function getEnv(name: string): string | undefined {
	if (typeof process === "undefined") {
		return undefined;
	}
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedProvider(value: string | undefined): value is SupportedProvider {
	return value === "openai" || value === "openai-codex";
}

function normalizeReasoningEffort(value: ReasoningEffort | undefined): Exclude<ReasoningEffort, "minimal"> | undefined {
	if (!value) {
		return undefined;
	}
	return value === "minimal" ? "low" : value;
}

function normalizeDomain(domain: string): string | undefined {
	const trimmed = domain.trim().toLowerCase();
	if (!trimmed) {
		return undefined;
	}
	const withoutScheme = trimmed.replace(/^https?:\/\//, "");
	const [host] = withoutScheme.split("/");
	return host || undefined;
}

function normalizeDomains(domains: string[] | undefined): string[] | undefined {
	if (!domains?.length) {
		return undefined;
	}
	const normalized = domains.map(normalizeDomain).filter((domain): domain is string => Boolean(domain));
	return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function extractAccountId(token: string): string {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("OpenAI Codex auth token is not a valid JWT.");
	}
	const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as RecordValue;
	const authClaims = payload["https://api.openai.com/auth"];
	if (!isRecord(authClaims) || typeof authClaims.chatgpt_account_id !== "string") {
		throw new Error("OpenAI Codex auth token is missing chatgpt_account_id.");
	}
	return authClaims.chatgpt_account_id;
}

function normalizeCodexBaseUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	if (normalized.endsWith("/codex")) {
		return normalized;
	}
	if (normalized.endsWith("/codex/responses")) {
		return normalized.slice(0, -"/responses".length);
	}
	return `${normalized}/codex`;
}

function buildClient(config: SearchClientConfig): OpenAI {
	if (config.provider === "openai-codex") {
		const accountId = extractAccountId(config.apiKey);
		return new OpenAI({
			apiKey: config.apiKey,
			baseURL: normalizeCodexBaseUrl(config.baseUrl),
			defaultHeaders: {
				...config.headers,
				"chatgpt-account-id": accountId,
				originator: "pi-web-search",
				"OpenAI-Beta": "responses=experimental",
			},
		});
	}

	return new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
		defaultHeaders: config.headers,
	});
}

function formatSource(source: SearchSource, index: number): string {
	const label = source.title?.trim() || source.url;
	return `${index}. ${label} - ${source.url}`;
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const item of items) {
		if (seen.has(item.url)) {
			continue;
		}
		seen.add(item.url);
		deduped.push(item);
	}
	return deduped;
}

function extractCitations(response: { output?: unknown[] }): SearchCitation[] {
	const citations: SearchCitation[] = [];
	for (const item of response.output ?? []) {
		if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
			continue;
		}
		for (const block of item.content) {
			if (!isRecord(block) || !Array.isArray(block.annotations)) {
				continue;
			}
			for (const annotation of block.annotations) {
				if (!isRecord(annotation)) {
					continue;
				}
				const nested = isRecord(annotation.url_citation) ? annotation.url_citation : annotation;
				if (nested.type !== undefined && nested.type !== "url_citation") {
					continue;
				}
				if (typeof nested.url !== "string") {
					continue;
				}
				citations.push({
					title: typeof nested.title === "string" ? nested.title : undefined,
					url: nested.url,
					startIndex: typeof nested.start_index === "number" ? nested.start_index : undefined,
					endIndex: typeof nested.end_index === "number" ? nested.end_index : undefined,
				});
			}
		}
	}
	return dedupeByUrl(citations);
}

function extractSources(response: { output?: unknown[] }): SearchSource[] {
	const sources: SearchSource[] = [];
	for (const item of response.output ?? []) {
		if (!isRecord(item) || item.type !== "web_search_call" || !isRecord(item.action)) {
			continue;
		}
		if (!Array.isArray(item.action.sources)) {
			continue;
		}
		for (const source of item.action.sources) {
			if (!isRecord(source) || typeof source.url !== "string") {
				continue;
			}
			sources.push({
				title: typeof source.title === "string" ? source.title : undefined,
				url: source.url,
				type: typeof source.type === "string" ? source.type : undefined,
			});
		}
	}
	return dedupeByUrl(sources);
}

function getResolvedModel(
	ctx: ExtensionContext,
	provider: SupportedProvider,
	requestedModelId?: string,
): Model<Api> | undefined {
	if (requestedModelId) {
		return ctx.modelRegistry.find(provider, requestedModelId);
	}
	if (ctx.model?.provider === provider) {
		return ctx.model;
	}
	return ctx.modelRegistry.find(provider, DEFAULT_MODEL_BY_PROVIDER[provider]);
}

async function resolveSearchClientConfig(ctx: ExtensionContext): Promise<SearchClientConfig> {
	const requestedProvider = getEnv("PI_WEB_SEARCH_PROVIDER");
	const requestedModelId = getEnv("PI_WEB_SEARCH_MODEL");

	const candidates: SupportedProvider[] = [];
	if (requestedProvider === "current") {
		if (ctx.model && isSupportedProvider(ctx.model.provider)) {
			candidates.push(ctx.model.provider);
		}
	} else if (isSupportedProvider(requestedProvider)) {
		candidates.push(requestedProvider);
	}
	if (ctx.model && isSupportedProvider(ctx.model.provider) && !candidates.includes(ctx.model.provider)) {
		candidates.push(ctx.model.provider);
	}
	for (const provider of SUPPORTED_PROVIDERS) {
		if (!candidates.includes(provider)) {
			candidates.push(provider);
		}
	}

	for (const provider of candidates) {
		const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
		if (!apiKey) {
			continue;
		}
		const model = getResolvedModel(ctx, provider, requestedModelId);
		return {
			provider,
			modelId: model?.id ?? requestedModelId ?? DEFAULT_MODEL_BY_PROVIDER[provider],
			apiKey,
			baseUrl:
				model?.baseUrl ??
				(provider === "openai-codex" ? "https://chatgpt.com/backend-api" : "https://api.openai.com/v1"),
			headers: model?.headers,
		};
	}

	throw new Error(
		"No OpenAI web search auth is available. Log in to `openai-codex` with `/login` or set `OPENAI_API_KEY`.",
	);
}

function buildUserLocation(params: WebSearchParameters):
	| {
			type: "approximate";
			country?: string;
			city?: string;
			region?: string;
			timezone?: string;
		}
	| undefined {
	if (!params.country && !params.city && !params.region && !params.timezone) {
		return undefined;
	}
	return {
		type: "approximate",
		country: params.country,
		city: params.city,
		region: params.region,
		timezone: params.timezone,
	};
}

function getDefaultReasoningEffort(): ReasoningEffort {
	const envValue = getEnv("PI_WEB_SEARCH_REASONING_EFFORT");
	if (envValue === "minimal" || envValue === "low" || envValue === "medium" || envValue === "high") {
		return envValue;
	}
	return "low";
}

function buildSearchPrompt(query: string): string {
	return [
		"Answer the user's request using web search.",
		"Return a concise, factual answer with inline citations when available.",
		"If the answer is uncertain, say so.",
		`User request: ${query}`,
	].join("\n");
}

async function executeWebSearch(params: WebSearchParameters, ctx: ExtensionContext, signal?: AbortSignal) {
	const config = await resolveSearchClientConfig(ctx);
	const client = buildClient(config);
	const allowedDomains = normalizeDomains(params.allowedDomains);
	const userLocation = buildUserLocation(params);
	const reasoningEffort = normalizeReasoningEffort(params.reasoningEffort ?? getDefaultReasoningEffort());
	const webSearchTool: ExtendedWebSearchTool = {
		type: "web_search",
		filters: allowedDomains ? { allowed_domains: allowedDomains } : undefined,
		search_context_size: params.searchContextSize,
		user_location: userLocation,
		external_web_access: params.externalWebAccess ?? true,
	};

	const response = await client.responses.create(
		{
			model: config.modelId,
			input: buildSearchPrompt(params.query),
			tool_choice: "required",
			include: ["web_search_call.action.sources"],
			tools: [webSearchTool],
			reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
		},
		signal ? { signal } : undefined,
	);

	const responseRecord = response as unknown as { id?: string; output?: unknown[]; output_text?: string };
	const answer = response.output_text?.trim() || "";
	const citations = extractCitations(responseRecord);
	const sources = extractSources(responseRecord);

	const text = [
		answer || "OpenAI web search returned no answer text.",
		...(sources.length > 0 ? ["", "Sources:", ...sources.slice(0, 12).map((source, index) => formatSource(source, index + 1))] : []),
	].join("\n");

	const details: WebSearchDetails = {
		provider: config.provider,
		model: config.modelId,
		query: params.query,
		externalWebAccess: params.externalWebAccess ?? true,
		searchContextSize: params.searchContextSize,
		allowedDomains,
		userLocation,
		citations,
		sources,
		responseId: responseRecord.id,
	};

	return { text, details };
}

function createWebSearchTool(): ToolDefinition<typeof WebSearchParametersSchema, WebSearchDetails> {
	return {
		name: "web_search",
		label: "Web Search",
		description: "Search the web with OpenAI web search and return a cited answer with sources.",
		promptSnippet:
			"web_search(query, ...): search the web for current information, optionally narrowing by domain, location, context size, or live-vs-cached mode.",
		promptGuidelines: [
			"Use `web_search` for current events, live facts, rapidly changing information, or when the user explicitly asks for web sources.",
			"Use `allowedDomains` when the user asks for official docs, vendor pages, or a narrow source set.",
			"Set `externalWebAccess: false` when cached/indexed results are sufficient or live access is undesirable.",
		],
		parameters: WebSearchParametersSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await executeWebSearch(params, ctx, signal);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	};
}

export function webSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool(createWebSearchTool());
}

export default webSearchExtension;
export { createWebSearchTool };
export type { SearchCitation, SearchSource, WebSearchDetails };
