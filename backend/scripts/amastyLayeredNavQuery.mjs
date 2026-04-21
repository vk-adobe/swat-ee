/**
 * Query Adobe LLM for Amasty Layered Navigation details.
 * Run: node scripts/amastyLayeredNavQuery.mjs
 */
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

const { chatCompletion } = await import('../utils/aiChat.js')

const prompt = `You are a Magento 2 / Adobe Commerce expert.

Provide concise, factual details about Amasty's "Layered Navigation" extension family (Amasty Improved Layered Navigation and related products):

1. What problem it solves for storefront catalog navigation
2. Main features (filters, SEO, AJAX, sliders, etc.) as commonly advertised
3. Typical composer package / module naming patterns if known (without guessing exact version numbers)
4. How it relates to native Magento layered navigation (what merchants usually add it for)
5. Any notable integration areas (Elasticsearch, catalog search, mobile)

Use bullet points. If something is uncertain, say so.`

async function main() {
  const text = await chatCompletion('adobe_llm', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: parseInt(process.env.ADOBE_LLM_TEST_MAX_TOKENS || '1200', 10),
    temperature: 0.3,
  })
  console.log(text)
}

main().catch((err) => {
  console.error('FAIL:', err.response?.status, err.response?.data ?? err.message)
  process.exit(1)
})
