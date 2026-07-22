/**
 * Canonical Bedrock model definitions — Single Source of Truth.
 *
 * This file is the ONLY place to add, remove, or modify Bedrock model metadata.
 * It is imported by:
 *   - packages/frontend  (FALLBACK_MODELS)
 *   - packages/agent     (resolveMaxTokens)
 *
 * NOTE: packages/cdk intentionally does NOT import from @moca/core to keep
 * CDK infrastructure free of runtime library dependencies. When adding a model
 * here, also update DEFAULT_CONFIG.bedrockModels in
 * packages/cdk/config/environment-utils.ts.
 */

/**
 * Reasoning (extended thinking) depth selectable in the UI for a
 * reasoning-capable model.
 *
 * `off` means "send no thinking field" — the model answers without extended
 * thinking. `low | high | max` map 1:1 onto the Bedrock Anthropic-native
 * `output_config.effort` level (paired with `thinking: { type: 'adaptive' }`).
 *
 * WHY effort, not budget_tokens: current Anthropic models on Bedrock (Mythos /
 * Opus 4.7+) reject the legacy `thinking: { type: 'enabled', budget_tokens }`
 * shape with a ValidationException — "use thinking.type.adaptive and
 * output_config.effort". Verified live (reasoning-depth.integration.test.ts).
 */
export type ReasoningDepth = 'off' | 'low' | 'high' | 'max';

/** Ordered list of selectable reasoning depths (UI order + runtime validation). */
export const REASONING_DEPTHS = ['off', 'low', 'high', 'max'] as const;

/**
 * Effort levels in increasing order, for per-model capping (see reasoningMaxEffort).
 * Exported as the single source of truth so the frontend's depth-cap UI cannot
 * drift from the runtime clamp in getReasoningConfig.
 */
export const EFFORT_ORDER: readonly Exclude<ReasoningDepth, 'off'>[] = ['low', 'high', 'max'];

export interface BedrockModelDefinition {
  /** Full model ID including cross-region inference profile prefix */
  readonly id: string;
  /** Display name shown in the UI model selector */
  readonly name: string;
  /** Provider */
  readonly provider: 'Anthropic' | 'Amazon' | 'Qwen' | 'OpenAI';
  /**
   * Maximum output tokens supported by this model.
   * Sources: Anthropic docs 2026-04, AWS docs.
   */
  readonly maxOutputTokens: number;
  /**
   * Whether this model supports Bedrock extended thinking / reasoning.
   * Only reasoning-capable models surface the depth selector in the UI and
   * accept a `thinking` request field. Omit (falsy) for models that don't.
   */
  readonly reasoningCapable?: boolean;
  /**
   * Highest selectable depth for this model. Only meaningful when
   * `reasoningCapable`. Defaults to `'max'` when omitted. Set to `'high'` for
   * non-Opus models (e.g. Sonnet 4.6) because Bedrock rejects
   * `output_config.effort: 'max'` on those — `max` is Opus-tier only. The UI
   * hides depths above this cap and the runtime clamps to it.
   */
  readonly reasoningMaxEffort?: Exclude<ReasoningDepth, 'off'>;
  /**
   * Optional invocation-region override.
   *
   * Most models are invoked in the deployment's BEDROCK_REGION. But some must be
   * invoked in a specific region — an In-Region-only model not yet rolled out
   * everywhere (despite what the AWS docs list), or a model whose account-level
   * prerequisite (e.g. Bedrock Data Retention mode) is only enabled in certain
   * regions. When set, createBedrockModel() routes this model's Bedrock calls to
   * this region regardless of BEDROCK_REGION.
   *
   * IAM: the foundation-model ARN is region-wildcarded
   * (arn:aws:bedrock:*::foundation-model/…), but a cross-region inference profile
   * (global.*, us.*, …) ALSO needs an inference-profile ARN, which is
   * region-scoped. CDK's deriveBedrockIamResources() therefore scopes that ARN to
   * THIS region (not the deployment region) so the pinned-region invocation is
   * authorized. For that to work the matching CDK config entry
   * (DEFAULT_CONFIG.bedrockModels in packages/cdk/config/environment-utils.ts)
   * MUST carry the same `region` value — the two lists are synced by hand because
   * CDK does not import @moca/core.
   *
   * Omit for models available in the deployment region (the common case).
   */
  readonly region?: string;
  /**
   * Which Bedrock endpoint this model is invoked through, when it is NOT the
   * default Converse API. This is a *transport* choice — endpoint URL + SDK
   * client + IAM service — independent of the model's vendor. Two non-Converse
   * endpoints exist on Bedrock (both verified live):
   *
   *   - `'bedrock-openai'` — the OpenAI-compatible surface on the standard
   *     Bedrock runtime host: `https://bedrock-runtime.{region}.amazonaws.com/openai/v1`.
   *     Uses the OpenAI **Chat Completions** API. IAM: standard
   *     `bedrock:InvokeModel*` (foundation-model ARN) + `bedrock:CallWithBearerToken`.
   *     Today: gpt-oss.
   *   - `'mantle'` — the Bedrock Mantle host:
   *     `https://bedrock-mantle.{region}.api.aws/openai/v1`. Uses the OpenAI
   *     **Responses** API. IAM: the SEPARATE `bedrock-mantle:` service
   *     (`CreateInference`/`Get*`/`List*` on `project/*` + `CallWithBearerToken`).
   *     Today: gpt-5.x. Mantle also hosts many non-OpenAI vendors (Anthropic,
   *     Google, Mistral, xAI, ZhipuAI, …), so this value is intentionally NOT
   *     named after OpenAI — any Mantle-hosted model uses `'mantle'`.
   *
   * When set, packages/agent's createBedrockModel() builds a Strands
   * `OpenAIModel` (baseURL + api mode derived from this endpoint, authenticated
   * with a locally-minted Bedrock bearer token) instead of a Converse-API
   * `BedrockModel`. Routing keys off this field rather than string-matching the
   * model id, so the transport decision lives in the SSoT.
   *
   * Omit for Converse-API models (the common case).
   */
  readonly endpoint?: BedrockEndpoint;
}

/**
 * Non-Converse Bedrock endpoints (transports). See
 * {@link BedrockModelDefinition.endpoint}. Omitting the field means the default
 * Converse API.
 */
export type BedrockEndpoint = 'bedrock-openai' | 'mantle';

/**
 * The canonical list of available Bedrock models.
 *
 * Ordering: preferred/newest models first (affects default selection in UI).
 *
 * When adding a model, also update:
 *   - packages/cdk/config/environment-utils.ts  DEFAULT_CONFIG.bedrockModels
 *     (mirror id/name/provider AND `region` if the model pins one — the region
 *     pin drives CDK's inference-profile IAM ARN, so an out-of-sync CDK entry
 *     causes AccessDenied at invocation time).
 */
export const BEDROCK_MODEL_DEFINITIONS = [
  {
    // Default model. No account-level prerequisite (unlike Fable 5's data
    // retention requirement), so it works out of the box in every region.
    id: 'jp.anthropic.claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'Anthropic',
    maxOutputTokens: 128000, // 128k (AWS Bedrock model card, 2026-05-28)
    reasoningCapable: true, // adaptive thinking + output_config.effort; max OK (Opus-tier)
  },
  {
    id: 'jp.anthropic.claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'Anthropic',
    maxOutputTokens: 128000, // 128k
    reasoningCapable: true, // max OK (Opus-tier)
  },
  {
    id: 'jp.anthropic.claude-opus-4-6-v1',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    maxOutputTokens: 128000, // 128k
    reasoningCapable: true, // max OK (Opus-tier)
  },
  {
    // GA on Bedrock 2026-11-01.
    id: 'jp.anthropic.claude-opus-4-5-20251101-v1:0',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    maxOutputTokens: 128000, // 128k
    reasoningCapable: true, // max OK (Opus-tier
  },
] as const satisfies readonly BedrockModelDefinition[];

/** Strips cross-region inference profile prefixes (global., us., eu., apac., jp.) */
const PROFILE_PREFIX = /^(global|us|eu|apac|jp)\./;

function stripPrefix(modelId: string): string {
  return modelId.replace(PROFILE_PREFIX, '');
}

/**
 * Single lookup used by every `getXxx(modelId)` accessor below: strips the
 * cross-region inference profile prefix so that e.g. `us.anthropic.claude-…`
 * matches the registry's `global.…` entry. Returns the widened interface type
 * so optional fields (`region`, `reasoningCapable`, …) hidden by the `as const`
 * literal union are readable. The single source of the match rule — every
 * accessor is a one-line projection over its result.
 */
function findModel(modelId: string): BedrockModelDefinition | undefined {
  const stripped = stripPrefix(modelId);
  return BEDROCK_MODEL_DEFINITIONS.find((m) => stripPrefix(m.id) === stripped);
}

/**
 * Lookup the maxOutputTokens for a given modelId, or undefined if not in the
 * registry. Prefix-insensitive (see {@link findModel}).
 */
export function getMaxOutputTokens(modelId: string): number | undefined {
  return findModel(modelId)?.maxOutputTokens;
}

/**
 * Lookup the invocation-region override for a given modelId, if any. Returns
 * undefined when the model has no override (the common case) or is not in the
 * registry — callers should then fall back to the deployment's BEDROCK_REGION.
 */
export function getModelRegion(modelId: string): string | undefined {
  return findModel(modelId)?.region;
}

/**
 * Whether the given model supports extended thinking / reasoning. Returns false
 * for unknown or non-capable models. The UI uses this to decide whether to show
 * the reasoning-depth selector.
 */
export function isReasoningCapable(modelId: string): boolean {
  return findModel(modelId)?.reasoningCapable === true;
}

/**
 * The non-Converse Bedrock endpoint (transport) for a model, or `undefined` for
 * Converse-API models (the common case) and unknown ids. Prefix-insensitive
 * (see {@link findModel}), though the current non-Converse ids carry no
 * inference-profile prefix.
 *
 * createBedrockModel() keys its BedrockModel-vs-OpenAIModel branch — and the
 * baseURL/api-mode choice — off this.
 */
export function getBedrockEndpoint(modelId: string): BedrockEndpoint | undefined {
  return findModel(modelId)?.endpoint;
}

/**
 * Shape of the Bedrock `additionalModelRequestFields` reasoning config.
 *
 * This `{ thinking: { type: 'adaptive' }, output_config: { effort } }` form is
 * the Anthropic-on-Bedrock native shape for current models (Mythos / Opus 4.7+):
 * the legacy `{ thinking: { type: 'enabled', budget_tokens } }` is rejected with
 * a ValidationException directing callers to adaptive + effort. Verified live
 * (reasoning-depth.integration.test.ts). If Bedrock changes the accepted shape,
 * fix it here and the integration test will confirm.
 */
export interface ReasoningRequestConfig {
  readonly thinking: {
    readonly type: 'adaptive';
    /**
     * `summarized` surfaces human-readable reasoning text in the response;
     * the model default is `omitted` (empty thinking text). We opt in so the
     * UI's reasoning panel has content to show. redactedContent is unaffected.
     */
    readonly display: 'summarized';
  };
  readonly output_config: {
    readonly effort: Exclude<ReasoningDepth, 'off'>;
  };
}

/**
 * Highest selectable reasoning depth for a model (defaults to `'max'`).
 *
 * Returns `undefined` for unknown or non-capable models. The UI uses this to
 * hide depths above the cap (e.g. Sonnet 4.6 tops out at `'high'` because
 * Bedrock rejects `effort: 'max'` on non-Opus models).
 */
export function getMaxReasoningDepth(
  modelId: string
): Exclude<ReasoningDepth, 'off'> | undefined {
  const match = findModel(modelId);
  if (!match?.reasoningCapable) {
    return undefined;
  }
  return match.reasoningMaxEffort ?? 'max';
}

/**
 * Resolve the Bedrock reasoning request config for a model + depth, or
 * `undefined` when no thinking field should be sent.
 *
 * Returns `undefined` when the model is unknown, not reasoning-capable, or the
 * depth is `off`. Otherwise returns the adaptive-thinking + effort payload to
 * spread into `additionalRequestFields`, clamping the effort to the model's
 * `reasoningMaxEffort` (so e.g. `max` on Sonnet 4.6 is sent as `high`).
 */
export function getReasoningConfig(
  modelId: string,
  depth: ReasoningDepth
): ReasoningRequestConfig | undefined {
  // Defend the SSoT helper itself: an unknown depth (e.g. a string that bypassed
  // the type via `as`) must resolve to "no thinking field", not fall through the
  // EFFORT_ORDER.indexOf(-1) clamp and reach Bedrock verbatim → ValidationException.
  if (depth === 'off' || !isReasoningDepth(depth)) {
    return undefined;
  }
  const match = findModel(modelId);
  if (!match?.reasoningCapable) {
    return undefined;
  }
  // Clamp to the model's ceiling (Opus → max, Sonnet → high).
  const cap = match.reasoningMaxEffort ?? 'max';
  const effort = EFFORT_ORDER.indexOf(depth) > EFFORT_ORDER.indexOf(cap) ? cap : depth;
  return { thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort } };
}

/** Runtime type guard for an externally-supplied reasoning depth value. */
export function isReasoningDepth(value: unknown): value is ReasoningDepth {
  return typeof value === 'string' && (REASONING_DEPTHS as readonly string[]).includes(value);
}
