import type { FolioConfig } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  chat(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
  ping(): Promise<boolean>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export function createLlmClient(cfg: FolioConfig): LlmClient | null {
  if (!cfg.llm.enabled) return null;
  const apiKey = cfg.llm.apiKey;
  if (!apiKey) return null;
  const url = `${cfg.llm.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const model = cfg.llm.model;

  async function request(
    messages: ChatMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            ...(opts?.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
            ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(
            `LLM 请求失败：HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`,
          );
        }
        const data = (await res.json()) as ChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('LLM 响应格式异常：缺少 choices[0].message.content');
        }
        return content;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    chat: (messages, opts) => request(messages, opts),
    async ping() {
      try {
        await request([{ role: 'user', content: 'ping' }], { maxTokens: 1 });
        return true;
      } catch {
        return false;
      }
    },
  };
}
