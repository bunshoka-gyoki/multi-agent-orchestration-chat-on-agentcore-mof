/**
 * Factory for OpenAI models hosted on Amazon Bedrock.
 *
 * Why this exists
 * ---------------
 * Bedrock exposes OpenAI models behind OpenAI-compatible endpoints that speak
 * the Chat Completions or Responses API, not the Converse API used by every
 * other Moca model. Rather than hand-rolling a client, we reuse the Strands
 * SDK's built-in `OpenAIModel` (it ships Chat + Responses adapters and
 * bidirectional message/tool formatting) and point it at the right Bedrock base
 * URL with a Bedrock-minted bearer token.
 *
 * Two endpoint families (both verified live against Bedrock)
 * ----------------------------------------------------------
 *   - `'bedrock-chat'`     — gpt-oss (open-weight). Base URL
 *     `https://bedrock-runtime.{region}.amazonaws.com/openai/v1`, **Chat
 *     Completions** (`api: 'chat'`). Rejects the Responses API.
 *   - `'mantle-responses'` — gpt-5.x. Base URL
 *     `https://bedrock-mantle.{region}.api.aws/openai/v1`, **Responses** API
 *     (`api: 'responses'`, the SDK default). Rejects Chat Completions.
 *
 * The endpoint family comes from the model registry (getOpenAiEndpoint), so the
 * URL/API-mode decision stays in the SSoT rather than string-matching here.
 *
 * Auth
 * ----
 * `@aws/bedrock-token-generator` mints a short-lived bearer token locally by
 * SigV4-presigning a `CallWithBearerToken` action against the invocation
 * region — no STS or network round-trip. The token inherits the task role's
 * permissions server-side, but the API-key auth path itself is gated by the
 * `bedrock:CallWithBearerToken` IAM action (granted in CDK). We pass the
 * provider as an `apiKey` function (OpenAI SDK `ApiKeySetter`) so a fresh token
 * is fetched before each request — tokens are valid ~12h, so this is cheap and
 * avoids expiry mid-session.
 */

import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { getTokenProvider } from '@aws/bedrock-token-generator';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { getMaxOutputTokens, type OpenAiEndpoint } from '@moca/core';
import { logger } from '../libs/logger/index.js';

export interface BedrockOpenAiModelOptions {
  modelId: string;
  /** Invocation region — must be a region that hosts the model. */
  region: string;
  /** Which OpenAI-compatible endpoint family this model uses (from the registry). */
  endpoint: OpenAiEndpoint;
  /** Explicit maxTokens override; falls back to the registry limit. */
  maxTokens?: number;
}

/**
 * Base URL + OpenAI SDK `api` mode for each endpoint family. The SDK appends the
 * concrete path (`/chat/completions` or `/responses`) to the base URL.
 */
function resolveEndpoint(
  endpoint: OpenAiEndpoint,
  region: string
): { baseURL: string; api: 'chat' | 'responses' } {
  switch (endpoint) {
    case 'bedrock-chat':
      return {
        baseURL: `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
        api: 'chat',
      };
    case 'mantle-responses':
      return {
        baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1`,
        api: 'responses',
      };
  }
}

/**
 * Build a Strands `OpenAIModel` wired to the correct Bedrock OpenAI-compatible
 * endpoint for the model's family.
 *
 * Deliberately omits prompt caching (unsupported for OpenAI models) and the
 * Anthropic-native `thinking` reasoning field (a different mechanism). Both
 * families are used statelessly, so Moca's own session-history management (the
 * persistence hook) remains the single source of conversation state — for the
 * Responses API that means `stateful` defaults to false (no server-side
 * previous_response_id chaining).
 *
 * Reasoning disabled for the Mantle (gpt-5.x) family — see
 * {@link responsesParams}. Without this, tool calls crash the agent turn.
 */
export function createBedrockOpenAiModel(options: BedrockOpenAiModelOptions): OpenAIModel {
  const { modelId, region, endpoint } = options;
  const { baseURL, api } = resolveEndpoint(endpoint, region);

  // Reusable token provider: mints a fresh Bedrock bearer token (SigV4-presigned
  // CallWithBearerToken) from the default credential chain, scoped to the
  // invocation region. Returns `() => Promise<string>` — the OpenAI SDK's
  // ApiKeySetter shape — so it is invoked before each request.
  const apiKey = getTokenProvider({
    credentials: defaultProvider(),
    region,
  });

  logger.debug(
    { modelId, region, baseURL, api, endpoint },
    'Creating Bedrock OpenAI model:'
  );

  return new OpenAIModel({
    api,
    modelId,
    maxTokens: options.maxTokens ?? getMaxOutputTokens(modelId),
    apiKey,
    ...responsesParams(endpoint),
    clientConfig: {
      baseURL,
      maxRetries: 5,
    },
  });
}

/**
 * Extra request params for the Responses API family (gpt-5.x on Mantle).
 *
 * `reasoning: { effort: 'none' }` disables the model's hidden reasoning phase.
 * WHY THIS IS REQUIRED, not an optimization: gpt-5.x are reasoning models, and
 * with reasoning enabled they spend the output budget on reasoning tokens and
 * then TRUNCATE the tool-call arguments mid-string. Mantle returns the response
 * as `incomplete` (reason `max_output_tokens`) but mislabels the partial
 * `function_call` as `status: 'completed'`; the Strands SDK then flushes the
 * truncated arguments and `JSON.parse`s them, throwing
 * `SyntaxError: Unterminated string in JSON` and killing the whole agent turn.
 * Verified live: reproduces 100% with tools at every max_output_tokens value
 * (16k–128k and omitted); `reasoning.effort: 'none'` fixes it 100%. `'minimal'`
 * is rejected by gpt-5.5 (`unsupported_value`), so `'none'` is the safe choice.
 * Passed via `params` (spread verbatim into the Responses request by the SDK).
 *
 * The Chat Completions family (gpt-oss) has no reasoning phase, so no extra
 * params — returns `{}`.
 */
function responsesParams(endpoint: OpenAiEndpoint): { params?: Record<string, unknown> } {
  if (endpoint === 'mantle-responses') {
    return { params: { reasoning: { effort: 'none' } } };
  }
  return {};
}
