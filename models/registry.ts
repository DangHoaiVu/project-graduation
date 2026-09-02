import { runtimeEnv } from '@/db/runtime';
import { getGeminiClient, GEMINI_MODEL, GEMINI_BACKUP_MODELS } from './gemini';
import { getGroqClient, GROQ_MODEL, GROQ_BACKUP_MODELS } from './groq';
import { getOpenAIClient, OPENAI_MODELS } from './openai';
import { getAnthropicClient, ANTHROPIC_MODELS } from './anthropic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIProvider = 'gemini' | 'groq' | 'openai' | 'anthropic';

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
  /** Chat history in OpenAI-style format */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  /** Request JSON-only output (supported by Groq, OpenAI, Anthropic; Gemini uses responseMimeType) */
  jsonMode?: boolean;
  /** Enable Google Search Grounding (Gemini only) */
  googleSearchGrounding?: boolean;
}

export interface GenerateTextResult {
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groundingMetadata?: any;
}

// ---------------------------------------------------------------------------
// Available Models
// ---------------------------------------------------------------------------

export function getAvailableModels(): ModelOption[] {
  const env = runtimeEnv();
  const models: ModelOption[] = [];

  // Gemini
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  const geminiAvailable = !!geminiKey && !geminiKey.startsWith('AIzaSy...');
  const geminiModels = [GEMINI_MODEL, ...GEMINI_BACKUP_MODELS];
  const geminiLabels: Record<string, string> = {
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
  };
  for (const m of geminiModels) {
    models.push({
      id: `gemini:${m}`,
      provider: 'gemini',
      modelId: m,
      label: geminiLabels[m] || m,
      available: geminiAvailable,
    });
  }

  // OpenAI
  const openaiKey = env.OPENAI_API_KEY || '';
  const openaiAvailable = !!openaiKey && !openaiKey.startsWith('sk-proj-your');
  for (const m of OPENAI_MODELS) {
    models.push({
      id: `openai:${m.id}`,
      provider: 'openai',
      modelId: m.id,
      label: m.label,
      available: openaiAvailable,
    });
  }

  // Anthropic
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const anthropicAvailable = !!anthropicKey && !anthropicKey.startsWith('sk-ant-your');
  for (const m of ANTHROPIC_MODELS) {
    models.push({
      id: `anthropic:${m.id}`,
      provider: 'anthropic',
      modelId: m.id,
      label: m.label,
      available: anthropicAvailable,
    });
  }

  // Groq
  const groqKey = env.GROQ_API_KEY || '';
  const groqAvailable = !!groqKey && !groqKey.startsWith('gsk_your');
  const groqModels = [GROQ_MODEL, ...GROQ_BACKUP_MODELS];
  const groqLabels: Record<string, string> = {
    'openai/gpt-oss-120b': 'Groq GPT-OSS 120B',
    'qwen/qwen3.8-27b': 'Groq Qwen 3.8 27B',
  };
  for (const m of groqModels) {
    models.push({
      id: `groq:${m}`,
      provider: 'groq',
      modelId: m,
      label: groqLabels[m] || m,
      available: groqAvailable,
    });
  }

  return models;
}

// ---------------------------------------------------------------------------
// Unified Generate Text
// ---------------------------------------------------------------------------

/**
 * Parse a model selector string like "openai:gpt-4o" into provider and modelId.
 * Returns null for 'auto' or invalid formats.
 */
export function parseModelSelector(selector?: string): { provider: AIProvider; modelId: string } | null {
  if (!selector || selector === 'auto') return null;
  const idx = selector.indexOf(':');
  if (idx <= 0) return null;
  const provider = selector.slice(0, idx) as AIProvider;
  const modelId = selector.slice(idx + 1);
  if (!['gemini', 'groq', 'openai', 'anthropic'].includes(provider) || !modelId) return null;
  return { provider, modelId };
}

/** Call a specific provider with the given model. */
async function callProvider(
  provider: AIProvider,
  modelId: string,
  opts: GenerateTextOptions
): Promise<GenerateTextResult | null> {
  switch (provider) {
    case 'gemini':
      return callGemini(modelId, opts);
    case 'openai':
      return callOpenAI(modelId, opts);
    case 'anthropic':
      return callAnthropic(modelId, opts);
    case 'groq':
      return callGroq(modelId, opts);
    default:
      return null;
  }
}

/**
 * Generate text using a specific model or auto-fallback cascade.
 * Auto cascade: Gemini → OpenAI → Anthropic → Groq
 */
export async function generateText(
  modelSelector: string | undefined,
  opts: GenerateTextOptions
): Promise<GenerateTextResult> {
  const parsed = parseModelSelector(modelSelector);

  // If a specific model is selected, try it (with backup models from the same provider)
  if (parsed) {
    try {
      const result = await callProvider(parsed.provider, parsed.modelId, opts);
      if (result?.text) return result;
    } catch (err) {
      console.warn(`Selected model ${modelSelector} failed:`, err);
    }
    // If the selected model fails, still try auto-fallback
    console.warn(`Selected model ${modelSelector} failed, falling back to auto cascade`);
  }

  // Auto cascade: Gemini → OpenAI → Anthropic → Groq
  const cascadeProviders: Array<{ provider: AIProvider; models: string[] }> = [
    { provider: 'gemini', models: [GEMINI_MODEL, ...GEMINI_BACKUP_MODELS] },
    { provider: 'openai', models: OPENAI_MODELS.map(m => m.id) },
    { provider: 'anthropic', models: ANTHROPIC_MODELS.map(m => m.id) },
    { provider: 'groq', models: [GROQ_MODEL, ...GROQ_BACKUP_MODELS] },
  ];

  for (const { provider, models } of cascadeProviders) {
    for (const modelId of models) {
      try {
        const result = await callProvider(provider, modelId, opts);
        if (result?.text) return result;
      } catch (err) {
        console.warn(`Auto cascade: ${provider}:${modelId} failed:`, err);
      }
    }
  }

  return { text: '' };
}

// ---------------------------------------------------------------------------
// Provider-specific call implementations
// ---------------------------------------------------------------------------

async function callGemini(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.warn('Gemini client not available (check key)');
    return null;
  }

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

    if (opts.jsonMode) {
      config.responseMimeType = 'application/json';
    }

    if (opts.googleSearchGrounding) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await gemini.models.generateContent({
      model: modelId,
      contents: formattedContents,
      config,
    });

    const text = (response.text || '').trim();
    if (!text) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata || null;
    return { text, groundingMetadata };
  } catch (err) {
    console.warn(`callGemini (${modelId}) failed:`, err);
    return null;
  }
}

async function callOpenAI(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  const client = getOpenAIClient();
  if (!client) {
    console.warn('OpenAI client not available (check key)');
    return null;
  }

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: opts.system },
    ];

    if (opts.history) {
      for (const msg of opts.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: opts.userPrompt });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createOpts: any = {
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.1,
    };

    if (opts.jsonMode) {
      createOpts.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(createOpts);
    const text = completion.choices[0]?.message?.content?.trim() || '';
    if (!text) return null;

    return { text };
  } catch (err) {
    console.warn(`callOpenAI (${modelId}) failed:`, err);
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

    const response = await client.messages.create({
      model: modelId,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      temperature: opts.temperature ?? 0.1,
    });

    const textBlocks = response.content.filter(b => b.type === 'text');
    const text = textBlocks.map(b => (b as { type: 'text'; text: string }).text).join('').trim();
    if (!text) return null;

    return { text };
  } catch (err) {
    console.warn(`callAnthropic (${modelId}) failed:`, err);
    return null;
  }
}

async function callGroq(modelId: string, opts: GenerateTextOptions): Promise<GenerateTextResult | null> {
  const client = getGroqClient();
  if (!client) {
    console.warn('Groq client not available (check key)');
    return null;
  }

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: opts.system },
    ];

    if (opts.history) {
      for (const msg of opts.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: opts.userPrompt });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createOpts: any = {
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.1,
    };

    if (opts.jsonMode) {
      createOpts.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(createOpts);
    const text = completion.choices[0]?.message?.content?.trim() || '';
    if (!text) return null;

    return { text };
  } catch (err) {
    console.warn(`callGroq (${modelId}) failed:`, err);
    return null;
  }
}
