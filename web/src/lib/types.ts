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
