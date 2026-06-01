import type { ChatMessage } from '../../../src/llm.js'
import type { LLMProvider, ChatResult, ChatOptions } from '../../../src/providers/interfaces.js'

const BASE_URL = 'https://openrouter.ai/api/v1'

function headers(apiKey: string) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': window.location.origin,
    'X-Title': 'Miguelito',
  }
}

export async function streamChatOpenRouter(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  temperature: number,
  onChunk: (delta: string) => void,
): Promise<void> {
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: 1024 }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`OpenRouter error ${resp.status}: ${text.slice(0, 200)}`)
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) onChunk(delta)
      } catch { /* partial line, skip */ }
    }
  }
}

export function makeOpenRouterProvider(apiKey: string, model: string): LLMProvider {
  return {
    async chat(messages: ChatMessage[], _tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({
          model,
          messages,
          temperature: opts?.temperature ?? 0,
          max_tokens: opts?.maxTokens ?? 1024,
          ...(opts?.structured ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
      if (!resp.ok) throw new Error(`OpenRouter error ${resp.status}`)
      const json = await resp.json()
      return { content: json.choices?.[0]?.message?.content ?? null, toolCalls: [] }
    },

    async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
      const msgs: ChatMessage[] = []
      if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
      msgs.push({ role: 'user', content: userPrompt })
      const r = await this.chat(msgs, undefined, opts)
      return r.content ?? ''
    },

    async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
      const text = await this.complete(systemPrompt, userPrompt, { ...opts, structured: true, temperature: opts?.temperature ?? 0 })
      try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as T }
      catch { return {} as T }
    },
  }
}
