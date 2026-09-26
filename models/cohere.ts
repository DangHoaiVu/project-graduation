import { runtimeEnv } from '@/db/runtime';
import type { GenerateTextOptions, GenerateTextStreamOptions, GenerateTextResult } from './registry';

export const COHERE_MODEL = 'command-r-08-2024';
export const COHERE_BACKUP_MODELS = ['command-r', 'command-r-plus-08-2024'];

export function getCohereApiKey(): string {
  const env = runtimeEnv();
  const key = env.COHERE_API_KEY || process.env.COHERE_API_KEY || '';
  if (!key || key.startsWith('your_') || key === 'cohere_...') {
    return '';
  }
  return key.trim();
}

export function isCohereAvailable(): boolean {
  return !!getCohereApiKey();
}

/**
 * Call Cohere Chat API (non-streaming)
 * Supports Cohere v2 API with fallback to v1
 */
export async function callCohere(
  modelId: string,
  opts: GenerateTextOptions
): Promise<GenerateTextResult | null> {
  const apiKey = getCohereApiKey();
  if (!apiKey) return null;

  opts.signal?.throwIfAborted();

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: opts.system },
  ];

  if (opts.history && opts.history.length > 0) {
    for (const msg of opts.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: opts.userPrompt });

  // Try v2 Chat API first
  try {
    const res = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: opts.temperature ?? 0.2,
        frequency_penalty: 0.3,
        presence_penalty: 0.1,
      }),
      signal: opts.signal,
    });

    if (res.status === 429) {
      const errText = await res.text().catch(() => '');
      throw new Error(`429 rate limit / quota exceeded: ${errText}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`Cohere v2 chat failed (${res.status}): ${errText}`);
      // Fall through to v1 fallback below
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      const text =
        data.message?.content?.[0]?.text ||
        data.text ||
        '';
      if (text.trim()) {
        return { text: text.trim() };
      }
    }
  } catch (v2Err) {
    if (opts.signal?.aborted) throw v2Err;
    if (String(v2Err).includes('429')) throw v2Err;
    console.warn('Cohere v2 error, trying v1:', v2Err);
  }

  // Fallback to Cohere v1 API
  try {
    const chatHistory = (opts.history || []).map(h => ({
      role: h.role === 'user' ? 'USER' : 'CHATBOT',
      message: h.content,
    }));

    const resV1 = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId.startsWith('command-r') ? 'command-r' : modelId,
        message: opts.userPrompt,
        preamble: opts.system,
        chat_history: chatHistory,
        temperature: opts.temperature ?? 0.2,
      }),
      signal: opts.signal,
    });

    if (resV1.status === 429) {
      const errText = await resV1.text().catch(() => '');
      throw new Error(`429 rate limit / quota exceeded: ${errText}`);
    }

    if (!resV1.ok) {
      const errText = await resV1.text().catch(() => '');
      throw new Error(`Cohere v1 chat failed (${resV1.status}): ${errText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataV1 = (await resV1.json()) as any;
    const text = dataV1.text || '';
    if (text.trim()) {
      return { text: text.trim() };
    }
    return null;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw err;
  }
}

/**
 * Call Cohere Chat API with streaming
 */
export async function callCohereStream(
  modelId: string,
  opts: GenerateTextStreamOptions
): Promise<GenerateTextResult | null> {
  const apiKey = getCohereApiKey();
  if (!apiKey) return null;

  opts.signal?.throwIfAborted();

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: opts.system },
  ];

  if (opts.history && opts.history.length > 0) {
    for (const msg of opts.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: opts.userPrompt });

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.2,
      frequency_penalty: 0.3,
      presence_penalty: 0.1,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (res.status === 429) {
    const errText = await res.text().catch(() => '');
    throw new Error(`429 rate limit / quota exceeded: ${errText}`);
  }

  if (!res.ok) {
    // If stream fails, fallback to non-streaming callCohere
    const errText = await res.text().catch(() => '');
    console.warn(`Cohere stream failed (${res.status}): ${errText}, fallback to non-stream`);
    const fallback = await callCohere(modelId, opts);
    if (fallback?.text) {
      opts.onDelta(fallback.text);
      return fallback;
    }
    return null;
  }

  if (!res.body) {
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';
  let shouldStopLoop = false;

  try {
    while (!shouldStopLoop) {
      opts.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          // Cohere v2 streaming format: delta.message.content.text
          const delta =
            parsed.delta?.message?.content?.text ||
            parsed.text ||
            '';
          if (delta) {
            fullText += delta;
            opts.onDelta(delta);

            // Anti-loop safeguard: If the same 20+ char phrase repeats 3 times consecutively, break
            const recentTail = fullText.slice(-300);
            const tailLines = recentTail.split('\n').map(l => l.trim()).filter(l => l.length > 20);
            if (tailLines.length >= 3) {
              const lastLine = tailLines[tailLines.length - 1];
              if (tailLines[tailLines.length - 2] === lastLine && tailLines[tailLines.length - 3] === lastLine) {
                console.warn('[Cohere Stream] Repetition loop detected, stopping stream gracefully.');
                shouldStopLoop = true;
                break;
              }
            }
          }
        } catch {
          // ignore non-json SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const trimmedText = fullText.trim();
  if (!trimmedText) {
    // fallback if no text streamed
    return await callCohere(modelId, opts);
  }

  return { text: trimmedText };
}

