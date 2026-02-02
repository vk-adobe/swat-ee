import { OpenAI } from 'openai'
import axios from 'axios'

let client = null
if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

// Simple in-memory caches to avoid repeated calls in a single process
const moduleResearchCache = {}
const moduleEvalCache = {}
// Note: we intentionally avoid scraping vendor websites for versions
// because it produces unreliable results (e.g., placeholder or unrelated numbers).

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
  const coverageRaw = obj.coverage || obj.native_coverage || obj.coverage_level || ''
  const coverage = String(coverageRaw || '').toLowerCase()
  const upg = obj.upgrade_note || obj.upgradeNote || obj.minimum_version || ''
  const cites = Array.isArray(obj.citations)
    ? obj.citations
    : (typeof obj.citations === 'string' ? obj.citations.split(/[;,\n]\s*/).filter(Boolean) : [])
  return {
    recommendation: String(rec).toUpperCase(),
    confidence: isNaN(conf) ? 50 : Math.max(0, Math.min(100, Math.round(conf))),
    reason,
    native_alternative: nat,
    coverage: ['equivalent', 'partial', 'none'].includes(coverage) ? coverage : '',
    upgrade_note: sanitizeUpgradeNote(upg),
    citations: cites,
  }
}

function isReasonableVersion(version) {
  if (!version) return false
  const match = String(version).trim().replace(/^v/i, '').match(/^\d{1,4}(\.\d{1,4}){1,3}/)
  if (!match) return false
  const parts = match[0].split('.').map((v) => parseInt(v, 10))
  if (parts.some((v) => Number.isNaN(v))) return false
  const [major, minor = 0, patch = 0] = parts
  if (major >= 2000 && major <= 2100) {
    if (minor < 1 || minor > 12) return false
    if (patch < 0 || patch > 31) return false
    return true
  }
  return parts.every((v) => v >= 0 && v <= 100)
}

function sanitizeLatestVersion(version) {
  if (!version) return ''
  const normalized = String(version).trim()
  return isReasonableVersion(normalized) ? normalized.replace(/^v/i, '') : ''
}

function sanitizeUpgradeNote(note) {
  if (!note) return ''
  const versionRegex = /\b\d{1,4}(?:\.\d{1,4}){1,3}\b/g
  const matches = note.match(versionRegex) || []
  const hasBad = matches.some((v) => !isReasonableVersion(v))
  if (!hasBad) return note
  // Drop the note if it contains unreasonable placeholder versions
  return ''
}

// Phase 1: Research what the module does using AI
async function researchModuleInfo(moduleName, description, aiProvider = 'perplexity') {
  const cacheKey = `${moduleName}::${description || ''}::${aiProvider}`
  if (moduleResearchCache[cacheKey]) return moduleResearchCache[cacheKey]
  const researchPrompt = `You are analyzing an Adobe Commerce (Magento 2) extension/module to understand its real functionality.

Module: ${moduleName}
User Description: ${description || '(No description provided)'}

Use your product knowledge to determine:
1. The primary functionality and scope (what it does, who uses it, where it fits in Commerce).
2. Key user-facing or admin-facing features (3-6 bullet-style phrases).
3. Any known vendor or official source URL (vendor site or GitHub).
4. Any common version patterns (if known).
5. Confidence level in your understanding (0-100).

Respond with ONLY a JSON object (no markdown, no extra text):
{
  "purpose": "2-4 sentences describing exact functionality and scope",
  "capabilities": ["short feature phrase", "short feature phrase"],
  "vendor_url": "Official website or GitHub repo URL if known",
  "common_versions": "Typical version numbers",
  "notes": "Any important context or uncertainty",
  "confidence": 0-100
}

If unsure, still return valid JSON and state uncertainty in notes.`

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
  const evaluationPrompt = `You are an Adobe Commerce (Magento 2) consultant deciding whether this extension is needed, or can be replaced by native functionality.

Extension: ${moduleName}
Purpose (from research): ${purpose}
Currently Available Version: ${foundVersion || 'Unknown/Not in Packagist'}

Adobe Commerce OOTB Features (partial list):
${adobeCommerceOOTBFeatures}

Evaluate in this order:
1. Identify the exact business function (payment, shipping, catalog, merchandising, marketing, search, admin UX, integrations, etc.).
2. Determine whether Adobe Commerce provides equivalent native capability.
3. If native exists, specify what feature and whether it is equivalent, partial, or requires configuration/third-party services.
4. If native does NOT exist, justify KEEP (or UPDATE if version is outdated).
5. If the extension is obsolete or unused, recommend REMOVE with rationale.

Return ONLY valid JSON with:
{
  "recommendation": "KEEP" | "UPDATE" | "REPLACE_WITH_NATIVE" | "REMOVE",
  "confidence": 0-100,
  "native_alternative": "Exact native feature name (or 'None')",
  "coverage": "equivalent" | "partial" | "none",
  "reason": "2-4 sentences explaining the decision",
  "upgrade_note": "If native feature requires a newer Commerce version, mention minimum version"
}

Rules:
- If unsure about native coverage, use "partial" and lower confidence.
- Prefer "REPLACE_WITH_NATIVE" only when native coverage is equivalent or close with minor config.
- Use "UPDATE" when the extension is needed but version is old or missing.
- Always return valid JSON, no markdown.`

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

  const callbacks = typeof progressCallback === 'object' && progressCallback !== null
    ? progressCallback
    : { onProgress: progressCallback }
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : null
  const onItemStatus = typeof callbacks.onItemStatus === 'function' ? callbacks.onItemStatus : null

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
        if (onItemStatus) {
          onItemStatus({ rowIndex: item.rowIndex, moduleName: item.moduleName, status: 'ai_mocked' })
        }
        processed++
        if (onProgress) onProgress(processed / total)
        results.push({
          ...item,
          recommendedAction: 'KEEP',
          confidence: 80,
          explanation: 'Mock evaluation (OPENAI_MODE=mock)',
          nativeAlternative: 'N/A',
          nativeCoverage: 'none',
          upgradeNote: 'N/A',
          processedStatus: 'ai_mocked',
        })
        continue
      }

      console.info(`\n=== Evaluating ${item.moduleName} ===`)

      if (onItemStatus) {
        onItemStatus({ rowIndex: item.rowIndex, moduleName: item.moduleName, status: 'evaluating' })
      }

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

      // Phase 2: Evaluate against Adobe Commerce native features
      console.info('Phase 2: Evaluating against native features...')
      const evaluation = await evaluateAgainstNative(item.moduleName, research.purpose, item.latestVersion, aiProvider)

      if (interCallDelayMs > 0) await new Promise(r => setTimeout(r, interCallDelayMs))

      processed++
      if (onProgress) onProgress(processed / total)

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
        nativeCoverage: evaluation.coverage || '',
        // Latest version comes strictly from lookup (Packagist/GitHub), not AI
        latestVersion: sanitizeLatestVersion(item.latestVersion || ''),
        upgradeNote: evaluation.upgrade_note || '',
        citations,
        processedStatus: 'ai_evaluated',
      }

      console.info(`Result for ${item.moduleName}: ${result.recommendedAction} (${result.confidence}%)`)
      if (onItemStatus) {
        onItemStatus({ rowIndex: item.rowIndex, moduleName: item.moduleName, status: result.processedStatus })
      }
      results.push(result)
    } catch (err) {
      processed++
      if (onProgress) onProgress(processed / total)
      console.error(`Failed to evaluate ${item.moduleName}:`, err.message)

      if (onItemStatus) {
        onItemStatus({ rowIndex: item.rowIndex, moduleName: item.moduleName, status: 'ai_failed' })
      }
      results.push({
        ...item,
        recommendedAction: 'ERROR',
        confidence: 0,
        explanation: `Evaluation failed: ${err.message}`,
        nativeAlternative: 'Unknown',
        nativeCoverage: '',
        upgradeNote: '',
        citations: [],
        processedStatus: 'ai_failed',
      })
    }
  }

  return results
}
