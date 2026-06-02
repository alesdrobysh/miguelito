export interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  createdAt: string
}

export interface Profile {
  name: string
  goal: string
}

export interface ModelInfo {
  id: string
  name: string
  description: string
  size: string
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    name: 'Llama 3.2 1B',
    description: 'Rápido y ligero',
    size: '1.3 GB',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    name: 'Llama 3.2 3B',
    description: 'Balance ideal — recomendado',
    size: '2.1 GB',
  },
  {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    name: 'Phi 3.5 Mini',
    description: 'Excelente calidad multilingüe',
    size: '2.2 GB',
  },
]

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS[1].id

export interface OpenRouterModelInfo {
  id: string
  name: string
  description: string
}

export const OPENROUTER_MODELS: OpenRouterModelInfo[] = [
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    description: 'Rápido y económico — recomendado',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'Máxima calidad OpenAI',
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    name: 'Claude Haiku',
    description: 'Rápido, excelente español',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet',
    description: 'Alta calidad Anthropic',
  },
  {
    id: 'google/gemini-flash-1.5',
    name: 'Gemini Flash',
    description: 'Rápido, multilingüe',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B',
    description: 'Open source, gran calidad',
  },
]

export const DEFAULT_OPENROUTER_MODEL_ID = 'google/gemini-3.1-flash-lite-preview'
export const DEFAULT_EVALUATOR_MODEL_ID = 'deepseek/deepseek-v4-flash'
