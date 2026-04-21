import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { assertValidAiProvider, DEFAULT_AI_PROVIDER } from '../config/aiProviders.js'
import { chatCompletion, ensureOpenAIClientIfNeeded, providerLabelForLogs } from './aiChat.js'
import {
  findCatalogMatchesForModule,
  formatCatalogContextForPrompt,
  getExtensionVendorCatalogMtimeKey,
} from './extensionVendorCatalog.js'
import { isCoreOrBaseModuleName, shouldSkipForPartnerSelection } from './moduleNameGuards.js'

const GITHUB_HTTP_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'AdobeCommerce-ExtensionEvaluator/1.0',
}

// Simple in-memory caches to avoid repeated calls in a single process
const moduleResearchCache = {}
const moduleEvalCache = {}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const aiCachePath = path.resolve(__dirname, '../data/ai-cache.json')
/** mtime (ms) of ai-cache.json last time we loaded or wrote it; null until first touch */
let diskCacheFileMtimeMs = null
const diskCache = { research: {}, evaluation: {} }

/**
 * Reload disk JSON when the file changes on disk (e.g. `npm run refresh-ai-cache` or manual edit).
 * Clears in-memory LRU so disk stays authoritative across external resets.
 */
async function syncDiskCacheFromFileIfStale() {
  try {
    const st = await fs.stat(aiCachePath)
    if (diskCacheFileMtimeMs !== null && st.mtimeMs === diskCacheFileMtimeMs) {
      return
    }
    const raw = await fs.readFile(aiCachePath, 'utf8')
    const parsed = JSON.parse(raw)
    diskCache.research = parsed?.research || {}
    diskCache.evaluation = parsed?.evaluation || {}
    diskCacheFileMtimeMs = st.mtimeMs
    Object.keys(moduleResearchCache).forEach((k) => {
      delete moduleResearchCache[k]
    })
    Object.keys(moduleEvalCache).forEach((k) => {
      delete moduleEvalCache[k]
    })
  } catch {
    diskCache.research = {}
    diskCache.evaluation = {}
    await persistDiskCache()
  }
}

async function persistDiskCache() {
  const dir = path.dirname(aiCachePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(aiCachePath, JSON.stringify(diskCache, null, 2), 'utf8')
  try {
    const st = await fs.stat(aiCachePath)
    diskCacheFileMtimeMs = st.mtimeMs
  } catch {
    // keep previous diskCacheFileMtimeMs
  }
}

async function getDiskCache(section, key) {
  if (diskCacheFileMtimeMs === null) {
    await syncDiskCacheFromFileIfStale()
  }
  return diskCache?.[section]?.[key]
}

async function setDiskCache(section, key, value) {
  if (diskCacheFileMtimeMs === null) {
    await syncDiskCacheFromFileIfStale()
  }
  if (!diskCache[section]) diskCache[section] = {}
  diskCache[section][key] = value
  await persistDiskCache()
}
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
  // Align with versionLookup: allow Magento-style majors (e.g. 104.0.6)
  return parts.length <= 5 && parts.every((v) => v >= 0 && v <= 999_999)
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

function formatAiError(err) {
  if (!err) return 'Unknown error'
  const status = err.response?.status
  const data = err.response?.data
  if (data) {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data)
    return status ? `HTTP ${status}: ${serialized}` : serialized
  }
  return err.message || String(err)
}

// Phase 1: Research what the module does using AI
async function researchModuleInfo(moduleName, description, aiProvider = DEFAULT_AI_PROVIDER) {
  const catKey = await getExtensionVendorCatalogMtimeKey()
  const cacheKey = `${moduleName}::${description || ''}::${aiProvider}::${catKey}`
  if (moduleResearchCache[cacheKey]) {
    const diskHit = await getDiskCache('research', cacheKey)
    if (!diskHit) {
      await setDiskCache('research', cacheKey, moduleResearchCache[cacheKey])
    }
    return moduleResearchCache[cacheKey]
  }
  const diskHit = await getDiskCache('research', cacheKey)
  if (diskHit) {
    moduleResearchCache[cacheKey] = diskHit
    return diskHit
  }
  let catalogCtx = ''
  try {
    const matches = await findCatalogMatchesForModule(moduleName)
    catalogCtx = formatCatalogContextForPrompt(matches)
  } catch {
    /* optional enrichment */
  }
  const researchPrompt = `You are analyzing an Adobe Commerce (Magento 2) extension/module to understand its real functionality.

Module: ${moduleName}
User Description: ${description || '(No description provided)'}
${catalogCtx}

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
    const label = providerLabelForLogs(aiProvider)
    const content = await callAIWithRetry(() =>
      chatCompletion(aiProvider, {
        messages: [{ role: 'user', content: researchPrompt }],
        maxTokens: 300,
        temperature: 0.3,
      })
    )

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    console.info(`Research complete for ${moduleName} (${label}):`, parsed)
    moduleResearchCache[cacheKey] = parsed
    await setDiskCache('research', cacheKey, parsed)
    return parsed
  } catch (err) {
    const is429 = err.response?.status === 429 || err.message?.includes('429')
    const isQuotaError = err.message?.includes('quota') || err.message?.includes('exceeded')

    if (is429 || isQuotaError) {
      console.error(
        `AI API quota or rate limit (${providerLabelForLogs(aiProvider)}) for ${moduleName}. Check provider billing/configuration.`
      )
    } else {
      console.error(`Research failed for ${moduleName}:`, err.message)
    }
    
    return { purpose: 'Unknown', vendor_url: '', common_versions: '', notes: `Research failed: ${formatAiError(err)}` }
  }
}

// Phase 2: Evaluate against Adobe Commerce native features
async function evaluateAgainstNative(moduleName, purpose, foundVersion, aiProvider = DEFAULT_AI_PROVIDER) {
  const evalCacheKey = `${moduleName}::${purpose || ''}::${foundVersion || ''}::${aiProvider}`
  if (moduleEvalCache[evalCacheKey]) {
    const diskHit = await getDiskCache('evaluation', evalCacheKey)
    if (!diskHit) {
      await setDiskCache('evaluation', evalCacheKey, moduleEvalCache[evalCacheKey])
    }
    return moduleEvalCache[evalCacheKey]
  }
  const diskHit = await getDiskCache('evaluation', evalCacheKey)
  if (diskHit) {
    moduleEvalCache[evalCacheKey] = diskHit
    return diskHit
  }
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
    const label = providerLabelForLogs(aiProvider)
    const content = await callAIWithRetry(() =>
      chatCompletion(aiProvider, {
        messages: [{ role: 'user', content: evaluationPrompt }],
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
      })
    )

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    const normalized = normalizeEvaluationShape(parsed)
    console.info(`Evaluation complete for ${moduleName} (${label}):`, normalized)
    moduleEvalCache[evalCacheKey] = normalized
    await setDiskCache('evaluation', evalCacheKey, normalized)
    return normalized
  } catch (err) {
    const is429 = err.response?.status === 429 || err.message?.includes('429')
    const isQuotaError = err.message?.includes('quota') || err.message?.includes('exceeded')
    const pl = providerLabelForLogs(aiProvider)

    if (is429 || isQuotaError) {
      console.error(`AI API quota or rate limit (${pl}) for ${moduleName}. Check provider billing/configuration.`)
      return {
        recommendation: 'KEEP',
        confidence: 50,
        native_alternative: 'Unknown (quota exceeded)',
        reason: `${pl} API error: ${formatAiError(err)}`,
        upgrade_note: 'Resolve API quota or billing with your AI provider',
      }
    }
    
    console.error(`Evaluation failed for ${moduleName}:`, err.message)

    
    return {
      recommendation: 'KEEP',
      confidence: 50,
      native_alternative: 'Unknown',
      reason: `Evaluation failed: ${formatAiError(err)}`,
      upgrade_note: '',
    }
  }
}

export async function evaluateExtensions(withVersions, aiProvider = DEFAULT_AI_PROVIDER, progressCallback) {
  // Handle callback parameter position for backwards compatibility
  if (typeof aiProvider === 'function') {
    progressCallback = aiProvider
    aiProvider = DEFAULT_AI_PROVIDER
  }

  const callbacks = typeof progressCallback === 'object' && progressCallback !== null
    ? progressCallback
    : { onProgress: progressCallback }
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : null
  const onItemStatus = typeof callbacks.onItemStatus === 'function' ? callbacks.onItemStatus : null
  const shouldAbort = typeof callbacks.shouldAbort === 'function' ? callbacks.shouldAbort : null
  const partnerSkipPrefixes = callbacks.partnerSkipPrefixes ?? null

  assertValidAiProvider(aiProvider)
  console.info(`evaluateExtensions called with provider: ${aiProvider}`)

  await syncDiskCacheFromFileIfStale()

  ensureOpenAIClientIfNeeded(aiProvider)

  const total = withVersions.length
  let processed = 0
  const interCallDelayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || '0', 10)
  const fastMode = String(process.env.EVAL_FAST_MODE || '').toLowerCase() === 'true'

  // Use sequential processing with delays instead of Promise.all to avoid rate limits
  const results = []
  for (const item of withVersions) {
    if (shouldAbort && shouldAbort()) {
      throw new Error('Job cancelled by user')
    }
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

      if (isCoreOrBaseModuleName(item.moduleName)) {
        console.info(`Skipping exploration for ${item.moduleName} (module segment is Core/Base)`)
        if (onItemStatus) {
          onItemStatus({
            rowIndex: item.rowIndex,
            moduleName: item.moduleName,
            status: 'skipped_core_base',
          })
        }
        processed++
        if (onProgress) onProgress(processed / total)
        results.push({
          ...item,
          recommendedAction: 'KEEP',
          confidence: 100,
          explanation:
            'Skipped AI/extension research: the module name includes a Core or Base segment (platform or vendor foundation package), not a typical third-party feature extension.',
          nativeAlternative: 'N/A',
          nativeCoverage: 'none',
          upgradeNote: '',
          citations: [],
          processedStatus: 'skipped_core_base',
        })
        continue
      }

      if (shouldSkipForPartnerSelection(item.moduleName, partnerSkipPrefixes)) {
        console.info(`Skipping extension evaluation for ${item.moduleName} (matches selected partner vendor)`)
        if (onItemStatus) {
          onItemStatus({
            rowIndex: item.rowIndex,
            moduleName: item.moduleName,
            status: 'skipped_partner_selected',
          })
        }
        processed++
        if (onProgress) onProgress(processed / total)
        results.push({
          ...item,
          recommendedAction: 'KEEP',
          confidence: 100,
          explanation:
            'Skipped version lookup and AI evaluation: the module vendor matches the partner / organization you selected (extensions from your own catalog are excluded from this pass).',
          nativeAlternative: 'N/A',
          nativeCoverage: 'none',
          upgradeNote: '',
          citations: [],
          processedStatus: 'skipped_partner_selected',
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
              const ghRel = await axios.get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
                timeout: 7000,
                headers: GITHUB_HTTP_HEADERS,
              })
              if (ghRel.data?.tag_name || ghRel.data?.name) {
                item.latestVersion = ghRel.data.tag_name || ghRel.data.name
                item.latestUrl = ghRel.data.html_url
              }
            } catch (e1) {
              try {
                const ghTags = await axios.get(`https://api.github.com/repos/${owner}/${repo}/tags`, {
                  timeout: 7000,
                  headers: GITHUB_HTTP_HEADERS,
                })
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
        // Latest version comes strictly from lookup (Packagist/GitHub/research GitHub), not AI
        latestVersion: sanitizeLatestVersion(item.latestVersion || ''),
        latestUrl: item.latestUrl || '',
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
      const detail = formatAiError(err)
      console.error(`Failed to evaluate ${item.moduleName}:`, detail)

      if (onItemStatus) {
        onItemStatus({ rowIndex: item.rowIndex, moduleName: item.moduleName, status: 'ai_failed' })
      }
      results.push({
        ...item,
        recommendedAction: 'ERROR',
        confidence: 0,
        explanation: `Evaluation failed: ${detail}`,
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
