import { runtimeEnv } from '@/db/runtime';
import type { GenerateTextOptions, GenerateTextStreamOptions, GenerateTextResult } from './registry';

export const HORDE_MODEL = 'horde-auto';

export function getHordeApiKey(): string {
  const env = runtimeEnv();
  const key = env.AI_HORDE_API_KEY || process.env.AI_HORDE_API_KEY || '';
  if (!key || key.startsWith('your_') || key === '0000000000') {
    return '0000000000'; // Anonymous key with unlimited free quota
  }
  return key.trim();
}

/**
 * Format conversation messages into a single text prompt for Horde worker models
 */
function buildHordePrompt(system: string, history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined, userPrompt: string): string {
  const parts: string[] = [];
  if (system) {
    parts.push(`### System:\n${system.slice(0, 3000)}\n`);
  }
  if (history && history.length > 0) {
    for (const msg of history.slice(-4)) {
      parts.push(`${msg.role === 'user' ? '### User' : '### Assistant'}:\n${msg.content.slice(0, 1500)}\n`);
    }
  }
  parts.push(`### User:\n${userPrompt.slice(0, 4000)}\n\n### Assistant:`);
  return parts.join('\n');
}

/**
 * Call AI Horde decentralized text generation network (non-streaming)
 */
export async function callHorde(
  _modelId: string,
  opts: GenerateTextOptions
): Promise<GenerateTextResult | null> {
  const apiKey = getHordeApiKey();
  opts.signal?.throwIfAborted();

  const prompt = buildHordePrompt(opts.system, opts.history, opts.userPrompt);

  try {
    // 1. Submit async text generation task
    const postRes = await fetch('https://aihorde.net/api/v2/generate/text/async', {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Client-Agent': 'LMS-Assistant:1.0:lms-assistant',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        params: {
          max_context_length: 4096,
          max_length: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.3,
          top_p: opts.topP ?? 0.9,
        },
        models: [], // any available text worker
      }),
      signal: opts.signal,
    });

    if (!postRes.ok) {
      const errText = await postRes.text().catch(() => '');
      console.warn(`AI Horde async submission failed (${postRes.status}): ${errText}`);
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postData = (await postRes.json()) as any;
    const taskId = postData.id;
    if (!taskId) return null;

    // 2. Poll for completion (max 45 seconds)
    const startTime = Date.now();
    const maxWaitMs = 45000;

    while (Date.now() - startTime < maxWaitMs) {
      opts.signal?.throwIfAborted();
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await fetch(`https://aihorde.net/api/v2/generate/text/status/${taskId}`, {
        headers: {
          apikey: apiKey,
          'Client-Agent': 'LMS-Assistant:1.0:lms-assistant',
        },
        signal: opts.signal,
      });

      if (!statusRes.ok) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statusData = (await statusRes.json()) as any;
      if (statusData.is_possible === false) {
        console.warn('AI Horde task marked not possible by coordinator');
        return null;
      }

      if (statusData.done && Array.isArray(statusData.generations) && statusData.generations.length > 0) {
        const text = statusData.generations[0].text?.trim() || '';
        if (text) {
          return { text };
        }
      }
    }

    console.warn('AI Horde polling timed out after 45s');
    return null;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    console.warn('AI Horde call failed:', err);
    return null;
  }
}

/**
 * Call AI Horde with token-by-token streaming simulation
 */
export async function callHordeStream(
  modelId: string,
  opts: GenerateTextStreamOptions
): Promise<GenerateTextResult | null> {
  const result = await callHorde(modelId, opts);
  if (!result?.text) return null;

  // Stream out the completed text smoothly in small word chunks
  const words = result.text.split(/(\s+)/);
  for (const word of words) {
    opts.signal?.throwIfAborted();
    opts.onDelta(word);
    // tiny delay for pleasant visual typing cadence
    await new Promise(r => setTimeout(r, 12));
  }

  return result;
}

