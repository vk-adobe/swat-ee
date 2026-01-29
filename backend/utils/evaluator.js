import { OpenAI } from 'openai'
import axios from 'axios'

let client = null
if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

// Simple in-memory caches to avoid repeated calls in a single process
const moduleResearchCache = {}
const moduleEvalCache = {}
// Try to read the vendor website to detect a latest version string
async function tryVendorSiteVersion(vendorUrl) {
  if (!vendorUrl) return null
  try {
    const res = await axios.get(vendorUrl, { timeout: 8000 })
    const html = String(res.data || '')
    // Extract candidate version strings like 1.2.3, v1.2.3, 2024.12 etc.
    const matches = html.match(/(?:v|version[:\s]*)?([0-9]{1,4}\.[0-9]{1,3}(?:\.[0-9]{1,3})?)/gi) || []
    // Normalize and pick the most plausible by sorting descending lexicographically (approximation)
    const versions = matches
      .map(m => (m.match(/([0-9]{1,4}\.[0-9]{1,3}(?:\.[0-9]{1,3})?)/)?.[1] || '').trim())
      .filter(Boolean)
    if (!versions.length) return null
    const best = versions.sort((a, b) => (a === b ? 0 : a < b ? 1 : -1))[0]
    return { latestVersion: best, latestUrl: vendorUrl }
  } catch (_) {
    return null
  }
}

// Helper: retry with exponential backoff for rate-limit (429) errors
async function callAIWithRetry(fn, maxRetries = 2, timeout = 8000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout to prevent hanging on quota exhaustion
      return await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('API call timeout')), timeout)
        )
      ])
    } catch (err) {
      const is429 = err.response?.status === 429 || err.message?.includes('429')
      const isTimeout = err.message?.includes('timeout')
      
      if ((is429 || isTimeout) && attempt < maxRetries) {
        // Only retry once for quota exhaustion, then fail fast
        const delayMs = 1000
        console.warn(`Rate limit or timeout; retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`)
        await new Promise(r => setTimeout(r, delayMs))
      } else {
        throw err
      }
    }
  }
}

const adobeCommerceOOTBFeatures = `
- Product Reviews & Ratings (native review module)
- Product Bundles (native bundling)
- Grouped Products (native grouping)
- Configurable Products (native variants)
- Custom Attributes (native attribute system)
- Google Analytics 4 (native integration available)
- SEO Features (native URL rewrites, sitemaps, robots.txt)
- Email Templates & Transactional Emails (native email system)
- Advanced Pricing (tier pricing, special pricing, promotions)
- Customer Segmentation & Targeted Promotions (native customer groups, cart rules, catalog rules)
- Image Optimization & Lazy Loading (native capabilities in recent versions)
- Full-Page Cache & Varnish Integration (native FPC)
- ElasticSearch Integration (native support)
- PWA Features (Commerce Cloud includes PWA Studio)
`

function normalizeEvaluationShape(input) {
  const obj = input || {}
  const rec = obj.recommendation || obj.action || obj.decision || 'KEEP'
  const conf = Number(obj.confidence ?? obj.confidence_pct ?? obj.score ?? 50)
  const reason = obj.reason || obj.explanation || obj.summary || ''
  const nat = obj.native_alternative || obj.nativeAlternative || obj.native || ''
  const upg = obj.upgrade_note || obj.upgradeNote || obj.minimum_version || ''
  const cites = Array.isArray(obj.citations)
    ? obj.citations
    : (typeof obj.citations === 'string' ? obj.citations.split(/[;,\n]\s*/).filter(Boolean) : [])
  return {
    recommendation: String(rec).toUpperCase(),
    confidence: isNaN(conf) ? 50 : Math.max(0, Math.min(100, Math.round(conf))),
    reason,
    native_alternative: nat,
    upgrade_note: upg,
    citations: cites,
  }
}

// Phase 1: Research what the module does using AI
async function researchModuleInfo(moduleName, description, aiProvider = 'perplexity') {
  const cacheKey = `${moduleName}::${description || ''}::${aiProvider}`
  if (moduleResearchCache[cacheKey]) return moduleResearchCache[cacheKey]
  const researchPrompt = `You are researching an Adobe Commerce (Magento 2) extension/module.

Module: ${moduleName}
User Description: ${description || '(No description provided)'}

Search your knowledge for:
1. What does this module typically do?
2. Where would I find the vendor/developer's website?
3. What versions are commonly available?
4. Is this a popular/well-maintained extension?

Respond with ONLY a JSON object (no markdown, no extra text):
{
  "purpose": "What the module does (2-3 sentences)",
  "vendor_url": "Official website or GitHub repo URL if known",
  "common_versions": "Typical version numbers",
  "notes": "Any important context"
}

If unsure, provide your best guess. Always return valid JSON.`

  try {
    // Use provided aiProvider instead of environment variable
    if (aiProvider === 'perplexity') {
      if (!process.env.PERPLEXITY_API_KEY) {
        throw new Error('PERPLEXITY_API_KEY not configured')
      }

      const response = await callAIWithRetry(() =>
        axios.post(
          'https://api.perplexity.ai/chat/completions',
          {
            model: 'sonar',
            messages: [{ role: 'user', content: researchPrompt }],
            temperature: 0.3,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30_000,
          }
        )
      )

      const content = response.data?.choices?.[0]?.message?.content || '{}'
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
      console.info(`Research complete for ${moduleName} (Perplexity):`, parsed)
      moduleResearchCache[cacheKey] = parsed
      return parsed
    } else {
      // Use OpenAI
      if (!client) {
        throw new Error('OpenAI client not available')
      }

      const response = await callAIWithRetry(() =>
        client.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          messages: [{ role: 'user', content: researchPrompt }],
          temperature: 0.3,
          max_tokens: 300,
        })
      )

      const content = response.choices[0]?.message?.content || '{}'
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
      console.info(`Research complete for ${moduleName} (OpenAI):`, parsed)
      moduleResearchCache[cacheKey] = parsed
      return parsed
    }
  } catch (err) {
    const is429 = err.response?.status === 429 || err.message?.includes('429')
    const isQuotaError = err.message?.includes('quota') || err.message?.includes('exceeded')
    
    if (is429 || isQuotaError) {
      console.error(`OpenAI API QUOTA EXCEEDED for ${moduleName}. Please check your OpenAI account billing at https://platform.openai.com/account/billing/overview`)
    } else {
      console.error(`Research failed for ${moduleName}:`, err.message)
    }
    
    return { purpose: 'Unknown', vendor_url: '', common_versions: '', notes: 'Research failed' }
  }
}

// Phase 2: Evaluate against Adobe Commerce native features
async function evaluateAgainstNative(moduleName, purpose, foundVersion, aiProvider = 'perplexity') {
  const evalCacheKey = `${moduleName}::${purpose || ''}::${foundVersion || ''}::${aiProvider}`
  if (moduleEvalCache[evalCacheKey]) return moduleEvalCache[evalCacheKey]
  const evaluationPrompt = `You are an Adobe Commerce (Magento 2) consultant evaluating whether a custom extension is necessary.

Extension: ${moduleName}
Purpose: ${purpose}
Currently Available Version: ${foundVersion || 'Unknown/Not in Packagist'}

Adobe Commerce OOTB Features available:
${adobeCommerceOOTBFeatures}

Provide a JSON response with:
{
  "recommendation": "KEEP" | "UPDATE" | "REPLACE_WITH_NATIVE" | "REMOVE",
  "confidence": 0-100,
  "native_alternative": "Which native feature replaces this, if any",
  "reason": "2-3 sentence explanation",
  "upgrade_note": "If native feature is available only in newer AC versions, mention minimum version needed"
}

Always return valid JSON.`

  try {
    const MAX_TOKENS = parseInt(process.env.EVAL_MAX_TOKENS || '300', 10)
    // Use provided aiProvider instead of environment variable
    if (aiProvider === 'perplexity') {
      if (!process.env.PERPLEXITY_API_KEY) {
        throw new Error('PERPLEXITY_API_KEY not configured')
      }

      const response = await callAIWithRetry(() =>
        axios.post(
          'https://api.perplexity.ai/chat/completions',
          {
            model: 'sonar',
            messages: [{ role: 'user', content: evaluationPrompt }],
            temperature: 0.3,
            max_tokens: MAX_TOKENS,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30_000,
          }
        )
      )

      const content = response.data?.choices?.[0]?.message?.content || '{}'
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
      const normalized = normalizeEvaluationShape(parsed)
      console.info(`Evaluation complete for ${moduleName} (Perplexity):`, normalized)
      moduleEvalCache[evalCacheKey] = normalized
      return normalized
    } else {
      // Use OpenAI
      if (!client) {
        throw new Error('OpenAI client not available')
      }

      const response = await callAIWithRetry(() =>
        client.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          messages: [{ role: 'user', content: evaluationPrompt }],
          temperature: 0.3,
          max_tokens: MAX_TOKENS,
        })
      )

      const content = response.choices[0]?.message?.content || '{}'
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
      const normalized = normalizeEvaluationShape(parsed)
      console.info(`Evaluation complete for ${moduleName} (OpenAI):`, normalized)
      moduleEvalCache[evalCacheKey] = normalized
      return normalized
    }
  } catch (err) {
    // Check if it's a rate limit or quota error
    const is429 = err.response?.status === 429 || err.message?.includes('429')
    const isQuotaError = err.message?.includes('quota') || err.message?.includes('exceeded')
    
    if (is429 || isQuotaError) {
      console.error(`OpenAI API QUOTA EXCEEDED for ${moduleName}. Please check your OpenAI account billing at https://platform.openai.com/account/billing/overview`)
      return {
        recommendation: 'KEEP',
        confidence: 50,
        native_alternative: 'Unknown (quota exceeded)',
        reason: 'OpenAI API quota exceeded. Please upgrade your OpenAI account. Using conservative KEEP recommendation.',
        upgrade_note: 'Please add payment method at https://platform.openai.com/account/billing/overview',
      }
    }
    
    console.error(`Evaluation failed for ${moduleName}:`, err.message)

    
    return {
      recommendation: 'KEEP',
      confidence: 50,
      native_alternative: 'Unknown',
      reason: 'Evaluation failed; using conservative recommendation',
      upgrade_note: '',
    }
  }
}

export async function evaluateExtensions(withVersions, aiProvider = 'perplexity', progressCallback) {
  // Handle callback parameter position for backwards compatibility
  if (typeof aiProvider === 'function') {
    progressCallback = aiProvider
    aiProvider = 'perplexity'
  }

  console.info(`evaluateExtensions called with provider: ${aiProvider}`)
  console.info('OPENAI_API_KEY present?', !!process.env.OPENAI_API_KEY)
  
  // Validate provider
  const validProviders = ['perplexity', 'openai']
  if (!validProviders.includes(aiProvider)) {
    throw new Error(`Invalid AI provider: ${aiProvider}. Must be one of: ${validProviders.join(', ')}`)
  }

  // Ensure OpenAI client reflects current environment at call time (handles restarts)
  if (aiProvider === 'openai' && !client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    console.info('OpenAI client instantiated')
  }

  const total = withVersions.length
  let processed = 0
  const interCallDelayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || '0', 10)
  const fastMode = String(process.env.EVAL_FAST_MODE || '').toLowerCase() === 'true'

  // Use sequential processing with delays instead of Promise.all to avoid rate limits
  const results = []
  for (const item of withVersions) {
    try {
      // Allow explicit mock mode for deterministic testing
      if (process.env.OPENAI_MODE === 'mock') {
        processed++
        progressCallback(processed / total)
        results.push({
          ...item,
          recommendedAction: 'KEEP',
          confidence: 80,
          explanation: 'Mock evaluation (OPENAI_MODE=mock)',
          nativeAlternative: 'N/A',
          upgradeNote: 'N/A',
          processedStatus: 'ai_mocked',
        })
        continue
      }

      console.info(`\n=== Evaluating ${item.moduleName} ===`)

      let research = { purpose: item.description || item.moduleName, vendor_url: '' }
      if (!fastMode) {
        console.info('Phase 1: Researching module purpose...')
        research = await researchModuleInfo(item.moduleName, item.description, aiProvider)
      } else {
        console.info('Fast mode enabled: skipping research phase')
      }

      // Optional delay between calls (tunable via env)
      if (interCallDelayMs > 0) await new Promise(r => setTimeout(r, interCallDelayMs))

      // If version not found earlier and research points to GitHub, try deriving version from tags/releases
      try {
        if ((!item.latestVersion || !item.latestUrl) && research.vendor_url && /github\.com\//i.test(research.vendor_url)) {
          const m = research.vendor_url.match(/github\.com\/([^\/]+)\/([^\/#?]+)/i)
          if (m) {
            const owner = m[1]
            const repo = m[2].replace(/\.git$/, '')
            // Try releases/latest, fallback to tags
            try {
              const ghRel = await axios.get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { timeout: 7000 })
              if (ghRel.data?.tag_name || ghRel.data?.name) {
                item.latestVersion = ghRel.data.tag_name || ghRel.data.name
                item.latestUrl = ghRel.data.html_url
              }
            } catch (e1) {
              try {
                const ghTags = await axios.get(`https://api.github.com/repos/${owner}/${repo}/tags`, { timeout: 7000 })
                const first = (ghTags.data || [])[0]
                if (first?.name) {
                  item.latestVersion = first.name
                  item.latestUrl = `https://github.com/${owner}/${repo}/releases`
                }
              } catch (e2) {
                // ignore
              }
            }
          }
        }
      } catch (_) {}

      // If still missing or to double-check, attempt vendor site HTML scrape for a version hint
      try {
        if (research.vendor_url && (!item.latestVersion || !item.latestUrl)) {
          const v = await tryVendorSiteVersion(research.vendor_url)
          if (v?.latestVersion) {
            item.latestVersion = item.latestVersion || v.latestVersion
            item.latestUrl = item.latestUrl || v.latestUrl
          }
        }
      } catch (_) {}

      // Phase 2: Evaluate against Adobe Commerce native features
      console.info('Phase 2: Evaluating against native features...')
      const evaluation = await evaluateAgainstNative(item.moduleName, research.purpose, item.latestVersion, aiProvider)

      if (interCallDelayMs > 0) await new Promise(r => setTimeout(r, interCallDelayMs))

      processed++
      progressCallback(processed / total)

      // Build citations from multiple sources
      const urlRegex = /(https?:\/\/[\w.-]+\.[\w.-]+[^\s"']*)/g
      const urlsInReason = (evaluation.reason || '').match(urlRegex) || []
      const citations = [
        ...(evaluation.citations || []),
        research.vendor_url || '',
        item.latestUrl || '',
        ...urlsInReason,
      ].filter(Boolean)

      const result = {
        ...item,
        recommendedAction: evaluation.recommendation || 'KEEP',
        confidence: evaluation.confidence || 50,
        explanation: evaluation.reason || evaluation.explanation || 'Evaluation completed',
        nativeAlternative: evaluation.native_alternative || 'N/A',
        upgradeNote: evaluation.upgrade_note || '',
        citations,
        processedStatus: 'ai_evaluated',
      }

      console.info(`Result for ${item.moduleName}: ${result.recommendedAction} (${result.confidence}%)`)
      results.push(result)
    } catch (err) {
      processed++
      progressCallback(processed / total)
      console.error(`Failed to evaluate ${item.moduleName}:`, err.message)

      results.push({
        ...item,
        recommendedAction: 'ERROR',
        confidence: 0,
        explanation: `Evaluation failed: ${err.message}`,
        nativeAlternative: 'Unknown',
        upgradeNote: '',
        citations: [],
        processedStatus: 'ai_failed',
      })
    }
  }

  return results
}
