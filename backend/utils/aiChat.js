import axios from 'axios'
import { OpenAI } from 'openai'

import { assertValidAiProvider, normalizeAiProvider } from '../config/aiProviders.js'

let openaiClient = null

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured')
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

export function ensureOpenAIClientIfNeeded(aiProvider) {
  const id = normalizeAiProvider(aiProvider)
  if (id === 'openai' && !openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
}

/**
 * Azure OpenAI / Azure AI serverless samples use Authorization: Bearer + API key value.
 * Set ADOBE_LLM_AUTH_MODE=api-key if your resource only accepts the api-key header.
 */
function buildAdobeLlmAuthHeaders(apiKey) {
  const mode = (process.env.ADOBE_LLM_AUTH_MODE || '').trim().toLowerCase()
  if (mode === 'api-key') {
    return {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    }
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function parseEnvFloat(key, fallback) {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Deployment name from .../openai/deployments/{name}/chat/... */
function parseAzureDeploymentName(url) {
  try {
    const m = String(url).match(/\/deployments\/([^/]+)\//i)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * Matches Azure OpenAI chat completions shape (api-version 2025-01-01-preview style samples).
 * @see https://learn.microsoft.com/azure/ai-services/openai/ — Bearer + max_completion_tokens + model
 */
function buildAdobeLlmRequestBody(messages, maxTokens, temperature) {
  const url = (process.env.ADOBE_LLM_API_URL || '').trim()
  const deploymentName = parseAzureDeploymentName(url)
  const modelFromEnv = (process.env.ADOBE_LLM_MODEL || '').trim()
  const model = modelFromEnv || deploymentName

  const body = {
    messages,
    temperature,
    top_p: parseEnvFloat('ADOBE_LLM_TOP_P', 1),
    frequency_penalty: parseEnvFloat('ADOBE_LLM_FREQUENCY_PENALTY', 0),
    presence_penalty: parseEnvFloat('ADOBE_LLM_PRESENCE_PENALTY', 0),
    max_completion_tokens: maxTokens,
  }

  if (model) {
    body.model = model
  }

  return body
}

function extractMessageContent(raw) {
  if (!raw) return '{}'
  if (typeof raw === 'string') return raw
  const fromMessage = raw?.choices?.[0]?.message?.content
  if (fromMessage != null) return String(fromMessage)
  const fromText = raw?.choices?.[0]?.text
  if (fromText != null) return String(fromText)
  return '{}'
}

/**
 * Chat completion for evaluation flows. Returns raw assistant message text (JSON prompts expect JSON in reply).
 */
export async function chatCompletion(aiProvider, { messages, maxTokens, temperature = 0.3 }) {
  const provider = normalizeAiProvider(aiProvider)
  assertValidAiProvider(provider)

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required')
  }

  if (provider === 'perplexity') {
    if (!process.env.PERPLEXITY_API_KEY) {
      throw new Error('PERPLEXITY_API_KEY not configured')
    }
    const res = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: process.env.PERPLEXITY_MODEL || 'sonar',
        messages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      }
    )
    return extractMessageContent(res.data)
  }

  if (provider === 'openai') {
    const client = getOpenAIClient()
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      temperature,
      max_tokens: maxTokens,
    })
    return extractMessageContent(res)
  }

  if (provider === 'adobe_llm') {
    const rawUrl = (process.env.ADOBE_LLM_API_URL || '').trim()
    if (!rawUrl) {
      throw new Error('ADOBE_LLM_API_URL not configured')
    }
    const apiKey = (process.env.ADOBE_LLM_API_KEY || process.env.AZURE_API_KEY || '').trim()
    if (!apiKey) {
      throw new Error('ADOBE_LLM_API_KEY or AZURE_API_KEY not configured')
    }
    const url = rawUrl.includes('chat/completions')
      ? rawUrl
      : `${rawUrl.replace(/\/$/, '')}/chat/completions`

    if (String(process.env.ADOBE_LLM_STREAM || '').toLowerCase() === 'true') {
      throw new Error('ADOBE_LLM_STREAM=true is not supported; streaming responses are not handled')
    }

    const payload = buildAdobeLlmRequestBody(messages, maxTokens, temperature)

    const res = await axios.post(url, payload, {
      headers: buildAdobeLlmAuthHeaders(apiKey),
      timeout: parseInt(process.env.ADOBE_LLM_TIMEOUT_MS || '60000', 10),
    })
    return extractMessageContent(res.data)
  }

  if (provider === 'openai_compatible') {
    const baseUrl = (process.env.OPENAI_COMPAT_BASE_URL || '').replace(/\/$/, '')
    if (!baseUrl) {
      throw new Error('OPENAI_COMPAT_BASE_URL not configured')
    }
    if (!process.env.OPENAI_COMPAT_API_KEY) {
      throw new Error('OPENAI_COMPAT_API_KEY not configured')
    }
    const url = baseUrl.includes('chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/chat/completions`

    const res = await axios.post(
      url,
      {
        model: process.env.OPENAI_COMPAT_MODEL || 'gpt-4o',
        messages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: parseInt(process.env.OPENAI_COMPAT_TIMEOUT_MS || '60000', 10),
      }
    )
    return extractMessageContent(res.data)
  }

  throw new Error(`Unhandled AI provider: ${provider}`)
}

export function providerLabelForLogs(aiProvider) {
  const p = normalizeAiProvider(aiProvider)
  if (p === 'perplexity') return 'Perplexity'
  if (p === 'openai') return 'OpenAI'
  if (p === 'adobe_llm') return 'Adobe LLM'
  if (p === 'openai_compatible') return 'OpenAI-compatible'
  return p
}
