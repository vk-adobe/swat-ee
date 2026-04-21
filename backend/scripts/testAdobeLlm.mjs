/**
 * One-off smoke test for ADOBE_LLM_* / AZURE_API_KEY against Azure chat completions.
 * Run: node scripts/testAdobeLlm.mjs
 */
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

const { chatCompletion } = await import('../utils/aiChat.js')

async function main() {
  const url = process.env.ADOBE_LLM_API_URL
  const key = (process.env.ADOBE_LLM_API_KEY || process.env.AZURE_API_KEY || '').trim()
  if (!url?.trim()) {
    console.error('Missing ADOBE_LLM_API_URL in backend/.env')
    process.exit(1)
  }
  if (!key) {
    console.error('Missing ADOBE_LLM_API_KEY or AZURE_API_KEY in backend/.env')
    process.exit(1)
  }

  console.log('POST', url.replace(/\?.*/, '?…'))
  console.log('Auth: Bearer <key ' + key.length + ' chars>')

  const text = await chatCompletion('adobe_llm', {
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    maxTokens: 32,
    temperature: 0.2,
  })

  console.log('OK — assistant snippet:', JSON.stringify(text).slice(0, 280))
}

main().catch((err) => {
  console.error('FAIL:', err.response?.status, err.response?.data ?? err.message)
  process.exit(1)
})
