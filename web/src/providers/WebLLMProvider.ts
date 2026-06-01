import { CreateMLCEngine, type MLCEngine, type InitProgressReport } from '@mlc-ai/web-llm'

export type { InitProgressReport }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

let _engine: MLCEngine | null = null
let _modelId: string | null = null

export async function initEngine(
  modelId: string,
  onProgress: (report: InitProgressReport) => void,
): Promise<MLCEngine> {
  if (_engine && _modelId === modelId) return _engine
  _engine = await CreateMLCEngine(modelId, { initProgressCallback: onProgress })
  _modelId = modelId
  return _engine
}

export function getEngine(): MLCEngine | null {
  return _engine
}

export async function streamChat(
  messages: ChatMessage[],
  temperature: number,
  onChunk: (delta: string) => void,
): Promise<string> {
  const engine = _engine
  if (!engine) throw new Error('Engine not initialized')

  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature,
    max_tokens: 1024,
    stop: ['\nUser:', '\nLearner:'],
  })

  let full = ''
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (delta) {
      full += delta
      onChunk(delta)
    }
  }
  return full
}
