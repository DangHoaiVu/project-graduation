import { runtimeEnv } from '@/db/runtime';
import {
  executeWithGeminiPool,
  isAllGeminiKeysBlocked,
  getGeminiEarliestUnblockTime,
  getAvailableKeySlots,
  GEMINI_MODEL,
  GEMINI_BACKUP_MODELS,
} from './gemini';
import { getGroqClient, GROQ_MODEL, GROQ_BACKUP_MODELS } from './groq';
import { getAnthropicClient, ANTHROPIC_MODELS } from './anthropic';
import {
  isCohereAvailable,
  callCohere,
  callCohereStream,
  COHERE_MODEL,
  COHERE_BACKUP_MODELS,
} from './cohere';
import {
  callHorde,
  callHordeStream,
  HORDE_MODEL,
} from './horde';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIProvider = 'cohere' | 'gemini' | 'groq' | 'horde' | 'anthropic' | 'datacurso' | 'cache';

export interface ModelOption {
  /** Format: "provider:modelId" */
  id: string;
  provider: AIProvider;
  modelId: string;
  label: string;
  available: boolean;
}

export interface GenerateTextOptions {
  system: string;
  userPrompt: string;
  signal?: AbortSignal;
  /** Chat history in OpenAI-style format */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  topP?: number;
  /** Physical hard limit on response tokens (e.g. 250 for concise, 2500 for detailed) */
  maxTokens?: number;
  /** Request JSON-only output (supported by Groq, OpenAI, Anthropic; Gemini uses responseMimeType) */
  jsonMode?: boolean;
  /** Enable Google Search Grounding (Gemini only) */
  googleSearchGrounding?: boolean;
  /** Native RAG document chunks for models supporting native document grounding (Cohere) */
  documents?: Array<{ id?: string; title?: string; text: string }>;
  /**
   * Mode: allowExternalSource
   * - When true (Tấn công 4-3-3 / Sáng tạo): Gemini (Tiền đạo cắm) → Groq (Tiền vệ cánh) → Cohere (Dự bị chiến lược) → AI Horde (Thủ môn)
   * - When false (Phòng ngự 5-3-2 / RAG thép): Cohere (Mũi nhọn RAG) → Gemini (Chủ lực) → Groq (Cứu trợ) → AI Horde (Thủ môn)
   */
  allowExternalSource?: boolean;
}

export interface GenerateTextStreamOptions extends GenerateTextOptions {
  onDelta: (delta: string) => void;
  onMeta?: (meta: { modelName: string; modelId: string; provider: AIProvider }) => void;
}

export interface GenerateTextResult {
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groundingMetadata?: any;
  modelId?: string;
  provider?: AIProvider;
  modelName?: string;
}

// ---------------------------------------------------------------------------
// Daily Quota Circuit Breaker
// ---------------------------------------------------------------------------

// Tracks timestamp (ms) until which a provider is blocked due to quota/credit exhaustion
const providerBlockedUntil = new Map<AIProvider, number>();

function getNextDayMidnight(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
}

export function isProviderBlocked(provider: AIProvider): boolean {
  if (provider === 'horde') {
    return false; // AI Horde has unlimited decentralized quota
  }
  if (provider === 'gemini') {
    if (!isAllGeminiKeysBlocked()) {
      return false;
    }
  }
  const unblockTime = providerBlockedUntil.get(provider);
  if (!unblockTime) return false;
  if (Date.now() >= unblockTime) {
    providerBlockedUntil.delete(provider);
    return false;
  }
  return true;
}

export function unblockProvider(provider: AIProvider) {
  providerBlockedUntil.delete(provider);
}

export function blockProviderUntilTomorrow(provider: AIProvider, reason?: string) {
  if (provider === 'horde') return; // Never block unlimited safety net

  const str = (reason || '').toLowerCase();
  const isCreditZero = str.includes('credit balance') || str.includes('credit is too low') || str.includes('plans & billing');

  let unblockTime: number;
  if (isCreditZero) {
    unblockTime = getNextDayMidnight();
  } else if (provider === 'gemini') {
    // Only block gemini if all keys in the pool are exhausted
    if (!isAllGeminiKeysBlocked()) {
      return;
    }
    const earliest = getGeminiEarliestUnblockTime();
    unblockTime = Math.max(earliest, Date.now() + 30000);
  } else {
    // Groq, Cohere, and standard rate limits are 60s windows
    unblockTime = Date.now() + 60 * 1000;
  }

  providerBlockedUntil.set(provider, unblockTime);
  const resetStr = new Date(unblockTime).toLocaleTimeString();
  console.warn(`[AI Circuit Breaker] Provider "${provider}" reached limit (${reason || '429 / Rate limit'}). Pausing "${provider}" until ${resetStr}.`);
}

export function isQuotaExhaustedError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number })?.status;
  // HTTP 413 is Payload/Request Too Large (e.g., prompt exceeds TPM or request size)
  // This is a payload issue, not an account quota exhaustion. Do NOT block the provider.
  if (status === 413) return false;

  const str = String(err).toLowerCase();
  const msg = (err as { message?: string })?.message?.toLowerCase() || '';
  const code = String((err as { code?: string | number })?.code || '').toLowerCase();

  // If the error specifically mentions "request too large" or "please reduce your message size", it's a payload size issue
  if (str.includes('request too large') || msg.includes('request too large') || str.includes('reduce your message size') || msg.includes('reduce your message size')) {
    return false;
  }

  if (status === 429) return true;
  if (code.includes('insufficient_quota') || code.includes('credit_balance') || code.includes('resource_exhausted')) return true;

  const quotaKeywords = [
    'credit balance',
    'insufficient_quota',
    'resource_exhausted',
    'rate limit',
    'rate_limit',
    'quota',
    'too many requests',
    '429',
    'credit is too low',
    'credits remaining',
    'billing',
  ];

  return quotaKeywords.some(kw => str.includes(kw) || msg.includes(kw));
}

// ---------------------------------------------------------------------------
// Available Models
// ---------------------------------------------------------------------------

export function getAvailableModels(allowExternalSource?: boolean): ModelOption[] {
  const env = runtimeEnv();
  const models: ModelOption[] = [];

  // Gemini - check pool availability
  const activeGeminiSlots = getAvailableKeySlots();
  const geminiAvailable = activeGeminiSlots.length > 0 && !isProviderBlocked('gemini');
  const geminiModels = [GEMINI_MODEL, ...GEMINI_BACKUP_MODELS];
  const geminiLabels: Record<string, string> = {
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
  };
  const geminiOptions: ModelOption[] = geminiModels.map(m => ({
    id: `gemini:${m}`,
    provider: 'gemini',
    modelId: m,
    label: geminiLabels[m] || m,
    available: geminiAvailable,
  }));

  // Anthropic
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const anthropicAvailable = !!anthropicKey && !anthropicKey.startsWith('sk-ant-your') && !isProviderBlocked('anthropic');
  const anthropicOptions: ModelOption[] = ANTHROPIC_MODELS.map(m => ({
    id: `anthropic:${m.id}`,
    provider: 'anthropic',
    modelId: m.id,
    label: m.label,
    available: anthropicAvailable,
  }));

  // Groq
  const groqKey = env.GROQ_API_KEY || '';
  const groqAvailable = !!groqKey && !groqKey.startsWith('gsk_your') && !isProviderBlocked('groq');
  const groqModels = [GROQ_MODEL, ...GROQ_BACKUP_MODELS];
  const groqLabels: Record<string, string> = {
    'openai/gpt-oss-120b': 'Groq GPT-OSS 120B (LPU Siêu tốc)',
    'qwen/qwen3.8-27b': 'Groq Qwen 3.8 27B (LPU)',
  };
  const groqOptions: ModelOption[] = groqModels.map(m => ({
    id: `groq:${m}`,
    provider: 'groq',
    modelId: m,
    label: groqLabels[m] || m,
    available: groqAvailable,
  }));

  // Cohere (Command R - Đặc trị RAG)
  const cohereAvailable = isCohereAvailable() && !isProviderBlocked('cohere');
  const cohereModels = [COHERE_MODEL, ...COHERE_BACKUP_MODELS];
  const cohereLabels: Record<string, string> = {
    'command-r-08-2024': 'Cohere Command R (Đặc trị RAG)',
    'command-r': 'Cohere Command R',
    'command-r-plus-08-2024': 'Cohere Command R+ (Chuyên sâu RAG)',
  };
  const cohereOptions: ModelOption[] = cohereModels.map(m => ({
    id: `cohere:${m}`,
    provider: 'cohere',
    modelId: m,
    label: cohereLabels[m] || m,
    available: cohereAvailable,
  }));

  // AI Horde (Lưới bảo hiểm phi tập trung - Quota Vô cực)
  const hordeAvailable = !isProviderBlocked('horde');
  const hordeOptions: ModelOption[] = [{
    id: `horde:${HORDE_MODEL}`,
    provider: 'horde',
    modelId: HORDE_MODEL,
    label: 'AI Horde (Mạng lưới Phi tập trung - Quota Vô cực)',
    available: hordeAvailable,
  }];

  if (allowExternalSource) {
    // ⚔️ TẤN CÔNG 4-3-3: Gemini (Chủ công) -> Groq (Phản công tốc độ) -> Cohere (Dự bị) -> AI Horde (Thủ môn)
    models.push(...geminiOptions, ...groqOptions, ...cohereOptions, ...hordeOptions);
  } else {
    // 🛡️ PHÒNG NGỰ 5-3-2: Cohere (Mũi nhọn RAG) -> Gemini (Chủ lực) -> Groq (Cứu trợ) -> AI Horde (Thủ môn)
    models.push(...cohereOptions, ...geminiOptions, ...groqOptions, ...hordeOptions);
  }

  if (anthropicAvailable) {
    models.push(...anthropicOptions);
  }

  return models;
}

// ---------------------------------------------------------------------------
// Unified Generate Text
// ---------------------------------------------------------------------------

/**
 * Parse a model selector string like "anthropic:claude-3-5-sonnet" into provider and modelId.
 * Returns null for 'auto' or invalid formats.
 */
export function parseModelSelector(selector?: string): { provider: AIProvider; modelId: string } | null {
  if (!selector || selector === 'auto') return null;
  const idx = selector.indexOf(':');
  if (idx <= 0) return null;
  const provider = selector.slice(0, idx) as AIProvider;
  const modelId = selector.slice(idx + 1);
  if (!['cohere', 'gemini', 'groq', 'horde', 'anthropic', 'datacurso', 'cache'].includes(provider) || !modelId) return null;
  return { provider, modelId };
}

/** Call a specific provider with the given model. */
export function getModelDisplayName(provider: AIProvider | string, modelId?: string): string {
  if (provider === 'cohere') {
    if (modelId?.includes('plus')) return 'Cohere Command R+ (RAG)';
    return 'Cohere Command R (RAG)';
  }
  if (provider === 'groq') {
    if (modelId?.includes('120b') || modelId?.includes('gpt-oss')) return 'Groq GPT-OSS 120B';
    if (modelId?.includes('qwen')) return 'Groq Qwen 27B';
    return 'Groq LPU';
  }
  if (provider === 'gemini') {
    if (modelId?.includes('pro')) return 'Gemini 2.5 Pro';
    return 'Gemini 2.5 Flash';
  }
  if (provider === 'horde') {
    return 'AI Horde (Vô cực)';
  }
  if (provider === 'anthropic') {
    if (modelId?.includes('haiku')) return 'Claude 3.5 Haiku';
    return 'Claude 3.5 Sonnet';
  }
  if (provider === 'cache') {
    return 'Bộ nhớ đệm (0 token)';
  }
  if (provider === 'datacurso') {
    // Backward compatibility for legacy requests: map to real underlying model
    return 'Groq GPT-OSS 120B';
  }
  return String(modelId || provider);
}

async function callProvider(
  provider: AIProvider,
  modelId: string,
  opts: GenerateTextOptions
): Promise<GenerateTextResult | null> {
  opts.signal?.throwIfAborted();
  if (isProviderBlocked(provider)) {
    return null;
  }
  let res: GenerateTextResult | null = null;
  switch (provider) {
    case 'cohere':
      res = await callCohere(modelId, opts);
      break;
    case 'gemini':
      res = await callGemini(modelId, opts);
      break;
    case 'groq':
      res = await callGroq(modelId, opts);
      break;
    case 'horde':
      res = await callHorde(modelId, opts);
      break;
    case 'anthropic':
      res = await callAnthropic(modelId, opts);
      break;
    case 'datacurso': {
      res = await callGroq(GROQ_MODEL, opts);
      if (!res?.text && GROQ_BACKUP_MODELS[0]) {
        res = await callGroq(GROQ_BACKUP_MODELS[0], opts);
      }
      if (!res?.text) {
        res = await callGemini(GEMINI_MODEL, opts);
      }
      break;
    }
    default:
      return null;
  }
  if (res && res.text) {
    return {
      ...res,
      provider,
      modelId,
      modelName: getModelDisplayName(provider, modelId),
    };
  }
  return res;
}

/**
 * Auto-Cascade Fallback Lineup
 * - External ON (Tấn công 4-3-3 / Sáng tạo tối đa):
 *   1. Tiền đạo cắm (Chủ công): Gemini (Gemini 2.5 Flash / Pro - tri thức sâu rộng, logic linh hoạt)
 *   2. Tiền vệ cánh (Phản công tốc độ): Groq (Llama-3 / Qwen - văn phong phóng khoáng, sinh text siêu tốc)
 *   3. Tiền vệ mỏ neo (Dự bị chiến lược): Cohere (Command R - bảo toàn lực lượng, giữ nhịp khi cần)
 *   4. Thủ môn (Chốt chặn an toàn): AI Horde (Lưới an toàn vĩnh cửu, Quota vô cực)
 *
 * - External OFF (Phòng ngự 5-3-2 / Kỷ luật RAG thép):
 *   1. Tiền đạo (Chuyên sâu RAG): Cohere (Command R - Đặc trị RAG)
 *   2. Chủ lực (Cân bằng): Gemini (Gemini 2.5 Flash / Pro)
 *   3. Trâu cày (Tốc độ): Groq (Llama-3 / Qwen)
 *   4. Thủ môn (Chốt chặn an toàn): AI Horde (Lưới an toàn vĩnh cửu)
 */
function getCascadeLineup(isExternal: boolean): Array<{ provider: AIProvider; models: string[] }> {
  if (isExternal) {
    return [
      { provider: 'gemini', models: [GEMINI_MODEL, ...GEMINI_BACKUP_MODELS] },
      { provider: 'groq', models: [GROQ_MODEL, ...GROQ_BACKUP_MODELS] },
      { provider: 'cohere', models: [COHERE_MODEL, ...COHERE_BACKUP_MODELS] },
      { provider: 'horde', models: [HORDE_MODEL] },
    ];
  }
  return [
    { provider: 'cohere', models: [COHERE_MODEL, ...COHERE_BACKUP_MODELS] },
    { provider: 'gemini', models: [GEMINI_MODEL, ...GEMINI_BACKUP_MODELS] },
    { provider: 'groq', models: [GROQ_MODEL, ...GROQ_BACKUP_MODELS] },
    { provider: 'horde', models: [HORDE_MODEL] },
  ];
}

/**
 * Generate text using a specific model or auto-fallback cascade.
 */
export async function generateText(
  modelSelector: string | undefined,
  opts: GenerateTextOptions
): Promise<GenerateTextResult> {
  const parsed = parseModelSelector(modelSelector);

  // If a specific model is selected and not blocked, try it
  if (parsed && !isProviderBlocked(parsed.provider)) {
    try {
      const result = await callProvider(parsed.provider, parsed.modelId, opts);
      if (result?.text) return result;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (isQuotaExhaustedError(err)) {
        blockProviderUntilTomorrow(parsed.provider, String(err));
      }
      console.warn(`Selected model ${modelSelector} failed:`, err);
    }
    // If the selected model fails, still try auto-fallback
    console.warn(`Selected model ${modelSelector} failed, falling back to auto cascade`);
  }

  const isExternal = Boolean(opts.allowExternalSource ?? opts.googleSearchGrounding);
  const cascadeProviders = getCascadeLineup(isExternal);

  for (const { provider, models } of cascadeProviders) {
    opts.signal?.throwIfAborted();
    if (provider === 'cohere' && !isCohereAvailable()) {
      continue;
    }
    if (isProviderBlocked(provider)) {
      continue;
    }
    for (const modelId of models) {
      try {
        opts.signal?.throwIfAborted();
        const result = await callProvider(provider, modelId, opts);
        if (result?.text) return result;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (isQuotaExhaustedError(err)) {
          blockProviderUntilTomorrow(provider, String(err));
          break;
        }
        console.warn(`Auto cascade: ${provider}:${modelId} failed:`, err);
      }
    }
  }

  return { text: '' };
}

/**
 * Stream text generation token by token.
 * Calls onDelta for each received chunk, and returns the accumulated result.
 */
export async function generateTextStream(
  modelSelector: string | undefined,
  opts: GenerateTextStreamOptions
): Promise<GenerateTextResult> {
  const parsed = parseModelSelector(modelSelector);

  // If a specific model is selected and not blocked, try it with stream
  if (parsed && !isProviderBlocked(parsed.provider)) {
    try {
      const result = await callProviderStream(parsed.provider, parsed.modelId, opts);
      if (result?.text) return result;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (isQuotaExhaustedError(err)) {
        blockProviderUntilTomorrow(parsed.provider, String(err));
      }
      console.warn(`Selected stream model ${modelSelector} failed:`, err);
    }
    console.warn(`Selected stream model ${modelSelector} failed, falling back to auto stream cascade`);
  }

  const isExternal = Boolean(opts.allowExternalSource ?? opts.googleSearchGrounding);
  const cascadeProviders = getCascadeLineup(isExternal);

  for (const { provider, models } of cascadeProviders) {
    opts.signal?.throwIfAborted();
    if (provider === 'cohere' && !isCohereAvailable()) {
      continue;
    }
    if (isProviderBlocked(provider)) {
      continue;
    }
    for (const modelId of models) {
      try {
        opts.signal?.throwIfAborted();
        const result = await callProviderStream(provider, modelId, opts);
        if (result?.text) return result;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (isQuotaExhaustedError(err)) {
          blockProviderUntilTomorrow(provider, String(err));
          break;
        }
        console.warn(`Auto stream cascade: ${provider}:${modelId} failed:`, err);
      }
    }
  }

  // Fallback to non-streaming generateText if streaming failed
  const fallback = await generateText(modelSelector, opts);
  if (fallback.text) {
    opts.onDelta(fallback.text);
  }
  return fallback;
}

/** Call a specific provider with streaming */
async function callProviderStream(
  provider: AIProvider,
  modelId: string,
  opts: GenerateTextStreamOptions
): Promise<GenerateTextResult | null> {
  opts.signal?.throwIfAborted();
  if (isProviderBlocked(provider)) {
    return null;
  }
  let metaSent = false;
  const wrappedOpts: GenerateTextStreamOptions = {
    ...opts,
    onDelta: (delta: string) => {
      if (!metaSent) {
        metaSent = true;
        opts.onMeta?.({
          modelName: getModelDisplayName(provider, modelId),
          modelId,
          provider,
        });
      }
      opts.onDelta(delta);
    },
  };

  let res: GenerateTextResult | null = null;
  switch (provider) {
    case 'cohere':
      res = await callCohereStream(modelId, wrappedOpts);
      break;
    case 'gemini':
      res = await callGeminiStream(modelId, wrappedOpts);
      break;
    case 'groq':
      res = await callGroqStream(modelId, wrappedOpts);
      break;
    case 'horde':
      res = await callHordeStream(modelId, wrappedOpts);
      break;
    case 'anthropic':
      res = await callAnthropicStream(modelId, wrappedOpts);
      break;
    case 'datacurso': {
      res = await callGroqStream(GROQ_MODEL, wrappedOpts);
      if (!res?.text && GROQ_BACKUP_MODELS[0]) {
        res = await callGroqStream(GROQ_BACKUP_MODELS[0], wrappedOpts);
      }
      if (!res?.text) {
        res = await callGeminiStream(GEMINI_MODEL, wrappedOpts);
      }
      break;
    }
    default:
      return null;
  }
  if (res && res.text) {
    return {
      ...res,
      provider,
      modelId,
      modelName: getModelDisplayName(provider, modelId),
    };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Provider-specific call implementations
// ---------------------------------------------------------------------------

async function callGemini(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  try {
    const formattedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    if (opts.history && opts.history.length > 0) {
      let lastRole: string | null = null;
      for (const msg of opts.history) {
        const role = msg.role === 'user' ? 'user' : 'model';
        if (formattedContents.length === 0 && role !== 'user') continue;
        if (role === lastRole) {
          formattedContents[formattedContents.length - 1].parts.push({ text: msg.content });
        } else {
          formattedContents.push({ role, parts: [{ text: msg.content }] });
          lastRole = role;
        }
      }
    }
    formattedContents.push({ role: 'user', parts: [{ text: opts.userPrompt }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0.1,
    };

    if (opts.topP !== undefined) {
      config.topP = opts.topP;
    }

    if (opts.maxTokens !== undefined) {
      config.maxOutputTokens = opts.maxTokens;
    }

    if (opts.jsonMode) {
      config.responseMimeType = 'application/json';
    }

    if (opts.googleSearchGrounding) {
      config.tools = [{ googleSearch: {} }];
    }

    return await executeWithGeminiPool(async (client) => {
      let response;
      try {
        response = await client.models.generateContent({
          model: modelId,
          contents: formattedContents,
          config,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch (firstErr: any) {
        if (firstErr?.status === 503 || String(firstErr).includes('503')) {
          await new Promise(r => setTimeout(r, 1200));
          opts.signal?.throwIfAborted();
          response = await client.models.generateContent({
            model: modelId,
            contents: formattedContents,
            config,
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
        } else {
          throw firstErr;
        }
      }

      const text = (response.text || '').trim();
      if (!text) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata || null;
      return { text, groundingMetadata };
    }, opts.signal);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('gemini', String(err));
    }
    console.warn(`callGemini (${modelId}) failed:`, err);
    return null;
  }
}

async function callAnthropic(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  const client = getAnthropicClient();
  if (!client) {
    console.warn('Anthropic client not available (check key)');
    return null;
  }

  try {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (opts.history) {
      for (const msg of opts.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // For JSON mode, instruct Anthropic via system prompt suffix
    let systemPrompt = opts.system;
    if (opts.jsonMode) {
      systemPrompt += '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no extra text.';
    }

    messages.push({ role: 'user', content: opts.userPrompt });

    const anthropicParams: any = {
      model: modelId,
      max_tokens: opts.maxTokens ?? 8192,
      system: systemPrompt,
      messages,
      temperature: opts.temperature ?? 0.1,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };

    if (opts.topP !== undefined) {
      anthropicParams.top_p = opts.topP;
    }

    const response = await client.messages.create(anthropicParams);

    const textBlocks = response.content.filter(b => b.type === 'text');
    const text = textBlocks.map(b => (b as { type: 'text'; text: string }).text).join('').trim();
    if (!text) return null;

    return { text };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('anthropic', String(err));
    }
    console.warn(`callAnthropic (${modelId}) failed:`, err);
    return null;
  }
}

function prepareGroqMessages(
  system: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
  userPrompt: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  // Groq TPM limit on on-demand tier for openai/gpt-oss-120b is 8000 tokens (~24,000 chars)
  // We keep total characters strictly under 20,000 chars (~5,000 tokens) to guarantee safety.
  let remainingChars = 20000;

  // 1. System prompt (bounded)
  const safeSystem = system.length > 4000 ? system.slice(0, 4000) + '...' : system;
  remainingChars -= safeSystem.length;

  // 2. User prompt (bounded)
  let safeUserPrompt = userPrompt;
  if (safeUserPrompt.length > 12000) {
    safeUserPrompt = safeUserPrompt.slice(0, 12000) + '\n[...Nội dung tài liệu đã được tóm lược để vừa hạn mức xử lý LPU...]';
  }
  remainingChars -= safeUserPrompt.length;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: safeSystem },
  ];

  // 3. History (reverse fill until remainingChars exhausted)
  if (history && history.length > 0) {
    const keptHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (remainingChars - msg.content.length < 500) {
        break; // stop including older conversation turns
      }
      remainingChars -= msg.content.length;
      keptHistory.unshift(msg);
    }
    messages.push(...keptHistory);
  }

  messages.push({ role: 'user', content: safeUserPrompt });
  return messages;
}

async function callGroq(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  const client = getGroqClient();
  if (!client) {
    console.warn('Groq client not available (check key)');
    return null;
  }

  try {
    opts.signal?.throwIfAborted();
    const messages = prepareGroqMessages(opts.system, opts.history, opts.userPrompt);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createOpts: any = {
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.1,
    };

    if (opts.topP !== undefined) {
      createOpts.top_p = opts.topP;
    }

    if (opts.maxTokens !== undefined) {
      createOpts.max_tokens = opts.maxTokens;
    }

    if (opts.jsonMode) {
      createOpts.response_format = { type: 'json_object' };
    }

    // Do NOT pass signal to Groq SDK client call to avoid invalid request argument errors
    const completion = await client.chat.completions.create(createOpts);
    const text = completion.choices[0]?.message?.content?.trim() || '';
    if (!text) return null;

    return { text };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('groq', String(err));
    }
    console.warn(`callGroq (${modelId}) failed:`, err);
    return null;
  }
}

async function callGroqStream(modelId: string, opts: GenerateTextStreamOptions): Promise<GenerateTextResult | null> {
  const client = getGroqClient();
  if (!client) {
    console.warn('Groq client not available (check key)');
    return null;
  }

  try {
    opts.signal?.throwIfAborted();
    const messages = prepareGroqMessages(opts.system, opts.history, opts.userPrompt);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createOpts: any = {
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.1,
      stream: true,
    };

    if (opts.topP !== undefined) {
      createOpts.top_p = opts.topP;
    }

    if (opts.maxTokens !== undefined) {
      createOpts.max_tokens = opts.maxTokens;
    }

    if (opts.jsonMode) {
      createOpts.response_format = { type: 'json_object' };
    }

    // Do NOT pass signal to Groq SDK client call to avoid invalid request argument errors
    const stream = await client.chat.completions.create(createOpts);
    let fullText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of stream as any) {
      opts.signal?.throwIfAborted();
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        opts.onDelta(delta);
      }
    }

    const trimmed = fullText.trim();
    if (!trimmed) return null;
    return { text: trimmed };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('groq', String(err));
    }
    console.warn(`callGroqStream (${modelId}) failed:`, err);
    return null;
  }
}

async function callGeminiStream(modelId: string, opts: GenerateTextStreamOptions): Promise<GenerateTextResult | null> {
  try {
    const formattedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    if (opts.history && opts.history.length > 0) {
      let lastRole: string | null = null;
      for (const msg of opts.history) {
        const role = msg.role === 'user' ? 'user' : 'model';
        if (formattedContents.length === 0 && role !== 'user') continue;
        if (role === lastRole) {
          formattedContents[formattedContents.length - 1].parts.push({ text: msg.content });
        } else {
          formattedContents.push({ role, parts: [{ text: msg.content }] });
          lastRole = role;
        }
      }
    }
    formattedContents.push({ role: 'user', parts: [{ text: opts.userPrompt }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0.1,
    };

    if (opts.topP !== undefined) {
      config.topP = opts.topP;
    }

    if (opts.maxTokens !== undefined) {
      config.maxOutputTokens = opts.maxTokens;
    }

    if (opts.jsonMode) {
      config.responseMimeType = 'application/json';
    }

    if (opts.googleSearchGrounding) {
      config.tools = [{ googleSearch: {} }];
    }

    return await executeWithGeminiPool(async (client) => {
      const responseStream = await client.models.generateContentStream({
        model: modelId,
        contents: formattedContents,
        config,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });

      let fullText = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let groundingMetadata: any = null;
      for await (const chunk of responseStream) {
        opts.signal?.throwIfAborted();
        const text = chunk.text || '';
        if (text) {
          fullText += text;
          opts.onDelta(text);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((chunk as any).candidates?.[0]?.groundingMetadata) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          groundingMetadata = (chunk as any).candidates[0].groundingMetadata;
        }
      }

      const trimmed = fullText.trim();
      if (!trimmed) return null;
      return { text: trimmed, groundingMetadata };
    }, opts.signal);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('gemini', String(err));
    }
    console.warn(`callGeminiStream (${modelId}) failed:`, err);
    return null;
  }
}

async function callAnthropicStream(modelId: string, opts: GenerateTextStreamOptions): Promise<GenerateTextResult | null> {
  const client = getAnthropicClient();
  if (!client) {
    console.warn('Anthropic client not available (check key)');
    return null;
  }

  try {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (opts.history) {
      for (const msg of opts.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    let systemPrompt = opts.system;
    if (opts.jsonMode) {
      systemPrompt += '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no extra text.';
    }

    messages.push({ role: 'user', content: opts.userPrompt });

    const stream = client.messages.stream({
      model: modelId,
      max_tokens: opts.maxTokens ?? 8192,
      system: systemPrompt,
      messages,
      temperature: opts.temperature ?? 0.1,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    let fullText = '';
    for await (const chunk of stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (chunk.type === 'content_block_delta' && (chunk.delta as any).type === 'text_delta') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delta = (chunk.delta as any).text || '';
        if (delta) {
          fullText += delta;
          opts.onDelta(delta);
        }
      }
    }

    const trimmed = fullText.trim();
    if (!trimmed) return null;
    return { text: trimmed };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (isQuotaExhaustedError(err)) {
      blockProviderUntilTomorrow('anthropic', String(err));
    }
    console.warn(`callAnthropicStream (${modelId}) failed:`, err);
    return null;
  }
}
