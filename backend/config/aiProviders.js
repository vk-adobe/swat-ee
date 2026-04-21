/**
 * Single source of truth for AI backends used in extension evaluation.
 * Add new providers here and implement the corresponding branch in ../utils/aiChat.js.
 */

export const AI_PROVIDERS = [
  {
    id: 'adobe_llm',
    label: 'Adobe LLM',
    description: 'Azure OpenAI–style deployment URL (Bearer + max_completion_tokens)',
    envKeys: ['ADOBE_LLM_API_URL', 'ADOBE_LLM_API_KEY or AZURE_API_KEY'],
  },
  {
    id: 'perplexity',
    label: 'Perplexity (Sonar)',
    description: 'Perplexity AI chat completions',
    envKeys: ['PERPLEXITY_API_KEY'],
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    description: 'OpenAI API',
    envKeys: ['OPENAI_API_KEY'],
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible API',
    description: 'Any HTTP API with OpenAI-style /v1/chat/completions (Groq, Together, vLLM, Ollama, etc.)',
    envKeys: ['OPENAI_COMPAT_BASE_URL', 'OPENAI_COMPAT_API_KEY'],
  },
]

export const DEFAULT_AI_PROVIDER = 'adobe_llm'

const VALID_IDS = new Set(AI_PROVIDERS.map((p) => p.id))

export function isValidAiProvider(id) {
  return typeof id === 'string' && VALID_IDS.has(id.toLowerCase())
}

export function normalizeAiProvider(id) {
  if (!id || typeof id !== 'string') return DEFAULT_AI_PROVIDER
  const lower = id.toLowerCase()
  return VALID_IDS.has(lower) ? lower : DEFAULT_AI_PROVIDER
}

export function assertValidAiProvider(id) {
  if (!isValidAiProvider(id)) {
    const allowed = [...VALID_IDS].join(', ')
    throw new Error(`Invalid AI provider: ${id}. Must be one of: ${allowed}`)
  }
}
