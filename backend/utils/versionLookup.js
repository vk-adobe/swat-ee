import axios from 'axios'

import { isCoreOrBaseModuleName, shouldSkipForPartnerSelection } from './moduleNameGuards.js'

const packageCache = {}
const lookupCache = {}

// API endpoints and constants
const PACKAGIST_P2_BASE = 'https://repo.packagist.org/p2'
const PACKAGIST_P_BASE = 'https://repo.packagist.org/p'
const PACKAGIST_WEB_BASE = 'https://packagist.org'
const PACKAGIST_SEARCH_URL = `${PACKAGIST_WEB_BASE}/search.json`
const GITHUB_API_BASE = 'https://api.github.com/repos'
const API_TIMEOUT = 5000

/** Some registries block default clients; identify our app. */
const HTTP_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'AdobeCommerce-ExtensionEvaluator/1.0 (+https://github.com/)',
}
const SEARCH_TIMEOUT = 7000
const AMASTY_BASE_URL = 'https://amasty.com'

/** Vendor-specific product pages — HTML fallback when Packagist/GitHub miss */
const VENDOR_PAGE_STRATEGIES = {
  mageplaza: {
    buildUrls: (moduleKebab) => [
      `https://www.mageplaza.com/magento-2-${moduleKebab}-extension.html`,
      `https://www.mageplaza.com/magento-2-${moduleKebab}.html`,
    ],
  },
  mirasvit: {
    buildUrls: (moduleKebab) => [
      `https://mirasvit.com/magento-2-${moduleKebab}-extension.html`,
      `https://mirasvit.com/blog/magento-2-${moduleKebab}.html`,
    ],
  },
  bsscommerce: {
    buildUrls: (moduleKebab) => [
      `https://bsscommerce.com/magento-2-${moduleKebab}-extension.html`,
      `https://bsscommerce.com/magento-2-extension-${moduleKebab}.html`,
    ],
  },
  aheadworks: {
    buildUrls: (moduleKebab) => [
      `https://aheadworks.com/magento-2-extensions/${moduleKebab}.html`,
      `https://aheadworks.com/magento-extensions/${moduleKebab}.html`,
    ],
  },
  swissup: {
    buildUrls: (moduleKebab) => [
      `https://swissuplabs.com/magento2-${moduleKebab}.html`,
      `https://swissuplabs.com/magento-2-${moduleKebab}.html`,
    ],
  },
}

const HTML_VERSION_PATTERNS = [
  /\b(?:Version|Release|Current)\s*[:\s]+(v?\d{1,4}(?:\.\d{1,4}){1,3}(?:[-.]?(?:p|patch|pl)\d+)?)/i,
  /data-version=["']([^"']+)["']/i,
  /"latest_version"\s*:\s*"([^"]+)"/i,
  /\b(v?\d{1,4}\.\d{1,4}\.\d{1,4})\b\s*(?:<|&lt;|for Magento)/i,
]

// Optional vendor alias map to improve Packagist matches
const vendorAliases = {
  bss: 'bsscommerce',
  bsscommerce: 'bsscommerce',
  mageplaza: 'mageplaza',
  amasty: 'amasty',
  aheadworks: 'aheadworks',
  swissup: 'swissup',
  magesolution: 'magesolution',
  anowave: 'anowave',
}

function toKebabCase(name) {
  if (!name) return ''
  // Replace underscores with hyphens, split camelCase/CamelCase to hyphens, lower-case
  return name
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

/**
 * Generate a cache key with optional prefix
 * @param {string} prefix - Cache key prefix
 * @param {...string} parts - Key parts to join
 * @returns {string} Cache key
 */
function getCacheKey(prefix, ...parts) {
  return `${prefix}:${parts.join(':')}`
}

/**
 * Check if a version is stable (not dev or beta)
 * @param {string} version - Version string
 * @returns {boolean}
 */
function isStableVersion(version) {
  return version && !version.includes('dev') && !version.includes('beta') && !version.includes('alpha') && !version.includes('rc')
}

function normalizeVersion(version) {
  if (!version) return ''
  return String(version).trim().replace(/^v/i, '')
}

function extractNumericVersion(version) {
  if (!version) return ''
  const normalized = normalizeVersion(version)
  const match = normalized.match(/^\d{1,4}(\.\d{1,4}){1,3}/)
  return match ? match[0] : ''
}

function isNumericVersion(version) {
  return Boolean(extractNumericVersion(version))
}

function isReasonableVersion(version) {
  const numeric = extractNumericVersion(version)
  if (!numeric) return false
  const parts = numeric.split('.').map((v) => parseInt(v, 10))
  if (parts.some((v) => Number.isNaN(v))) return false

  const [major, minor = 0, patch = 0] = parts
  // Allow calendar-based versions like 2024.12(.x)
  if (major >= 2000 && major <= 2100) {
    if (minor < 1 || minor > 12) return false
    if (patch < 0 || patch > 31) return false
    return true
  }

  // Magento / Composer often uses large majors (e.g. 104.0.6 for module releases)
  return parts.length <= 5 && parts.every((v) => v >= 0 && v <= 999_999)
}

function compareVersions(a, b) {
  const aParts = extractNumericVersion(a).split('.').map((v) => parseInt(v, 10))
  const bParts = extractNumericVersion(b).split('.').map((v) => parseInt(v, 10))
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av > bv ? -1 : 1
  }
  return 0
}

function buildAmastySlugCandidates(item, moduleKebab) {
  const candidates = new Set()

  const fromPackages = (item.packageCandidates || [])
    .map((p) => String(p || '').toLowerCase())
    .filter(Boolean)

  for (const pkg of fromPackages) {
    const withoutVendor = pkg.includes('/') ? pkg.split('/')[1] : pkg
    const normalized = withoutVendor
      .replace(/^module-/, '')
      .replace(/^magento2-/, '')
      .replace(/_/g, '-')
    if (normalized) candidates.add(normalized)
  }

  if (moduleKebab) candidates.add(moduleKebab)

  return Array.from(candidates)
}

async function lookupAmastyVersion(item, moduleKebab) {
  const slugs = buildAmastySlugCandidates(item, moduleKebab)
  if (!slugs.length) return { found: false }

  const urlCandidates = []
  for (const slug of slugs) {
    urlCandidates.push(`${AMASTY_BASE_URL}/${slug}-for-magento-2.html`)
    urlCandidates.push(`${AMASTY_BASE_URL}/magento-2-${slug}.html`)
    urlCandidates.push(`${AMASTY_BASE_URL}/${slug}.html`)
  }

  const versionRegex = /\b(v?\d{1,4}(?:\.\d{1,4}){1,3}(?:[-.]?(?:p|patch|pl)\d+)?)\s*-\s*[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\b/

  for (const url of urlCandidates) {
    try {
      const response = await axios.get(url, { timeout: SEARCH_TIMEOUT, headers: HTTP_HEADERS })
      const html = String(response.data || '')
      const match = html.match(versionRegex)
      if (match?.[1] && isReasonableVersion(match[1])) {
        return {
          found: true,
          package: item.foundPackage || item.moduleName || '',
          latestVersion: match[1],
          latestUrl: url,
        }
      }
    } catch (err) {
      // Try next candidate
    }
  }

  return { found: false }
}

/**
 * Try to read a semver-like version from common extension landing page HTML.
 */
function extractVersionFromHtml(html) {
  const text = String(html || '').slice(0, 500_000)
  for (const re of HTML_VERSION_PATTERNS) {
    const m = text.match(re)
    if (m?.[1] && isReasonableVersion(m[1])) {
      return String(m[1]).trim()
    }
  }
  return null
}

/**
 * Fallback: fetch known vendor extension URLs (Mageplaza, Mirasvit, etc.).
 */
async function lookupVendorWebsitePages(vendor, moduleKebab, item) {
  const key = (vendorAliases[vendor] || vendor || '').toLowerCase()
  const strat = VENDOR_PAGE_STRATEGIES[key]
  if (!strat || !moduleKebab) return { found: false }

  const urls = strat.buildUrls(moduleKebab)
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        timeout: SEARCH_TIMEOUT,
        headers: HTTP_HEADERS,
        maxRedirects: 3,
        validateStatus: (s) => s >= 200 && s < 400,
      })
      const ver = extractVersionFromHtml(response.data)
      if (ver && isReasonableVersion(ver)) {
        return {
          found: true,
          package: item.foundPackage || item.moduleName || '',
          latestVersion: normalizeVersion(ver),
          latestUrl: url,
        }
      }
    } catch {
      // next URL
    }
  }
  return { found: false }
}

/**
 * Normalize Packagist JSON: `packages[name]` may be an array (p2 / Composer 2)
 * or an object mapping version string → metadata (legacy `/p/` provider).
 */
function versionsArrayFromPackagistPayload(packages, packageName) {
  const raw = packages?.[packageName]
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') return Object.values(raw)
  return []
}

/**
 * Lookup package version on Packagist by exact package name.
 * Tries Composer 2 `p2` JSON first, then legacy `p` provider.
 */
async function lookupPackagistVersion(packageName) {
  const cacheKey = getCacheKey('packagist', packageName)
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  const tryFetch = async (baseUrl) => {
    const url = `${baseUrl}/${packageName}.json`
    const response = await axios.get(url, { timeout: API_TIMEOUT, headers: HTTP_HEADERS })
    const versions = versionsArrayFromPackagistPayload(response.data?.packages, packageName)
    if (!versions.length) return null

    const stable = versions.filter((v) => v && isStableVersion(v.version))
    const pool = stable.length ? stable : versions.filter((v) => v?.version)
    const candidates = pool
      .map((v) => ({
        ...v,
        _normalized: v.version_normalized || extractNumericVersion(v.version || ''),
      }))
      .filter((v) => v.version && isReasonableVersion(v._normalized))
      .sort((a, b) => compareVersions(a._normalized, b._normalized))

    const latestStable = candidates[0]
    if (latestStable?.version) {
      return {
        found: true,
        package: packageName,
        latestVersion: latestStable.version,
        latestUrl: `${PACKAGIST_WEB_BASE}/packages/${packageName}`,
      }
    }
    return null
  }

  try {
    let hit = await tryFetch(PACKAGIST_P2_BASE).catch(() => null)
    if (!hit) hit = await tryFetch(PACKAGIST_P_BASE).catch(() => null)
    if (hit) {
      lookupCache[cacheKey] = hit
      return hit
    }
  } catch (err) {
    // Not found or error
  }

  return { found: false, package: packageName }
}

/**
 * Search Packagist — prefer Magento 2 module type, then any composer package match.
 */
async function searchPackagist(query, broad = false) {
  const cacheKey = getCacheKey(broad ? 'packagist-search-broad' : 'packagist-search', query)
  if (lookupCache[cacheKey]) return lookupCache[cacheKey]

  try {
    const typeParam = broad ? '' : 'type=magento2-module&'
    const url = `${PACKAGIST_SEARCH_URL}?q=${encodeURIComponent(query)}&${typeParam}per_page=25`
    const response = await axios.get(url, { timeout: SEARCH_TIMEOUT, headers: HTTP_HEADERS })
    const results = response.data?.results || []
    lookupCache[cacheKey] = results
    return results
  } catch (err) {
    return []
  }
}

/**
 * Pick latest reasonable semver from GitHub tags (many OSS modules never publish GitHub “releases”).
 */
function latestTagFromGitHubResponse(tagsPayload) {
  const tags = Array.isArray(tagsPayload) ? tagsPayload : []
  const candidates = tags
    .map((t) => t?.name || '')
    .filter(Boolean)
    .map((raw) => {
      const nv = extractNumericVersion(raw)
      return { raw, nv }
    })
    .filter((x) => x.nv && isReasonableVersion(x.nv))
    .sort((a, b) => compareVersions(a.nv, b.nv))

  const best = candidates[0]
  if (!best) return null
  return best.raw
}

/**
 * Lookup latest on GitHub: releases/latest first, then tags (common for Magento vendors on GitHub).
 */
async function lookupGitHubVersion(vendor, repo) {
  const cacheKey = getCacheKey('github', vendor, repo)
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  const base = `${GITHUB_API_BASE}/${vendor}/${repo}`

  try {
    const response = await axios.get(`${base}/releases/latest`, {
      timeout: API_TIMEOUT,
      headers: HTTP_HEADERS,
    })

    if (response.data?.tag_name || response.data?.name) {
      const rawVersion = response.data.tag_name || response.data.name
      const normalized = extractNumericVersion(rawVersion)
      if (!normalized || !isReasonableVersion(normalized)) {
        return { found: false }
      }
      const result = {
        found: true,
        package: `${vendor}/${repo}`,
        latestVersion: rawVersion,
        latestUrl: response.data.html_url || `https://github.com/${vendor}/${repo}/releases`,
      }
      lookupCache[cacheKey] = result
      return result
    }
  } catch (err) {
    // try tags
  }

  try {
    const tagRes = await axios.get(`${base}/tags`, {
      timeout: API_TIMEOUT,
      headers: HTTP_HEADERS,
      params: { per_page: 100 },
    })
    const tagName = latestTagFromGitHubResponse(tagRes.data)
    if (tagName) {
      const normalized = extractNumericVersion(tagName)
      if (normalized && isReasonableVersion(normalized)) {
        const encoded = encodeURIComponent(tagName)
        const result = {
          found: true,
          package: `${vendor}/${repo}`,
          latestVersion: tagName,
          latestUrl: `https://github.com/${vendor}/${repo}/releases/tag/${encoded}`,
        }
        lookupCache[cacheKey] = result
        return result
      }
    }
  } catch (err) {
    // fall through
  }

  return { found: false }
}

/**
 * Score search results based on vendor and module match
 * @param {Object} result - Search result object
 * @param {string} vendor - Vendor name
 * @param {string} moduleKebab - Module name in kebab-case
 * @returns {number} Score value
 */
function scoreSearchResult(result, vendor, moduleKebab) {
  const name = (result.name || '').toLowerCase()
  let score = 0

  if (vendor && name.startsWith(`${vendor}/`)) score += 2
  if (moduleKebab && name.includes(moduleKebab)) score += 2
  if (name.includes('magento')) score += 1

  return score
}

/** Turn Packagist search JSON hits into latestVersion/latestUrl when possible */
async function bestResultFromPackagistSearch(searchResults, vendor, moduleKebab) {
  if (!searchResults?.length) return null
  const scored = searchResults
    .map((r) => ({ r, score: scoreSearchResult(r, vendor, moduleKebab) }))
    .sort((a, b) => b.score - a.score)

  for (const { r } of scored) {
    if (!r?.name) continue
    const hit = await lookupPackagistVersion(r.name)
    if (hit.found) {
      return { foundPackage: hit.package, latestVersion: hit.latestVersion, latestUrl: hit.latestUrl }
    }
  }
  return null
}

/**
 * Lookup versions for normalized module list with batch processing
 * @param {Array} normalized - Normalized module list with moduleName and packageCandidates
 * @param {Object} options - Processing options (batchSize, skipErrors)
 * @returns {Promise<Array>} Results with version information
 */
export async function lookupVersions(normalized, options = {}) {
  const { batchSize = 10, skipErrors = true, partnerSkipPrefixes = null } = options
  const results = []

  // Process in batches to avoid rate limiting
  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((item) => lookupModuleVersion(item, skipErrors, { partnerSkipPrefixes }))
    )
    results.push(...batchResults)

    // Add small delay between batches
    if (i + batchSize < normalized.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  return results
}

/**
 * Lookup version for a single module
 * @param {Object} item - Module item
 * @param {boolean} skipErrors - Whether to skip errors
 * @returns {Promise<Object>} Result with version info
 */
async function lookupModuleVersion(item, skipErrors = true, lookupOpts = {}) {
  try {
    const name = item.moduleName || ''
    if (isCoreOrBaseModuleName(name)) {
      return {
        ...item,
        processedStatus: 'skipped_core_base',
      }
    }
    if (shouldSkipForPartnerSelection(name, lookupOpts.partnerSkipPrefixes)) {
      return {
        ...item,
        processedStatus: 'skipped_partner_selected',
      }
    }
    const pieces = name.split('_')
    let vendor = (pieces[0] || '').toLowerCase()
    if (vendorAliases[vendor]) vendor = vendorAliases[vendor]
    const moduleRaw = pieces.slice(1).join('_')
    const moduleKebab = toKebabCase(moduleRaw)

    // Expand candidate list with more Magento conventions
    const expanded = new Set([...(item.packageCandidates || [])])
    if (vendor && moduleKebab) {
      expanded.add(`${vendor}/${moduleKebab}`)
      expanded.add(`${vendor}/module-${moduleKebab}`)
      expanded.add(`${vendor}-module-${moduleKebab}`)
      expanded.add(`${vendor}-${moduleKebab}`)
      expanded.add(`${vendor}/magento2-${moduleKebab}`)
      expanded.add(`${vendor}/magento2-module-${moduleKebab}`)
      expanded.add(`magento2/${moduleKebab}`)
      // Magento core modules
      if (vendor === 'magento') {
        expanded.add(`magento/module-${moduleKebab}`)
      }
    }

    let found = null

    // 1) Exact Packagist hits
    for (const candidate of expanded) {
      const hit = await lookupPackagistVersion(candidate)
      if (hit.found) {
        found = { foundPackage: hit.package, latestVersion: hit.latestVersion, latestUrl: hit.latestUrl }
        break
      }
    }

    // 2) Packagist search — Magento 2 module type
    if (!found) {
      const query = [vendor, moduleKebab].filter(Boolean).join(' ')
      const searchResults = await searchPackagist(query || name, false)
      found = await bestResultFromPackagistSearch(searchResults, vendor, moduleKebab)
    }

    // 2b) Packagist broad search (any package type — many vendors omit magento2-module)
    if (!found) {
      const query = [vendor, moduleKebab].filter(Boolean).join(' ')
      const wide = await searchPackagist(query || name, true)
      found = await bestResultFromPackagistSearch(wide, vendor, moduleKebab)
    }

    // 3) Amasty product pages (structured date/version line)
    if (!found && vendor === 'amasty') {
      const amasty = await lookupAmastyVersion(item, moduleKebab)
      if (amasty.found) {
        found = {
          foundPackage: amasty.package || item.foundPackage || '',
          latestVersion: amasty.latestVersion,
          latestUrl: amasty.latestUrl,
        }
      }
    }

    // 3b) Other vendor catalog pages (HTML patterns)
    if (!found && moduleKebab) {
      const site = await lookupVendorWebsitePages(vendor, moduleKebab, item)
      if (site.found) {
        found = {
          foundPackage: site.package || item.foundPackage || '',
          latestVersion: site.latestVersion,
          latestUrl: site.latestUrl,
        }
      }
    }

    // 4) GitHub — latest release or tags
    if (!found) {
      for (const candidate of expanded) {
        if (candidate.includes('/')) {
          const [v, repo] = candidate.split('/')
          const gh = await lookupGitHubVersion(v, repo)
          if (gh.found) {
            found = { foundPackage: gh.package, latestVersion: gh.latestVersion, latestUrl: gh.latestUrl }
            break
          }
        }
      }
    }

    if (found) {
      return {
        ...item,
        ...found,
        foundPackage: item.foundPackage || found.foundPackage,
        latestVersion: isReasonableVersion(found.latestVersion)
          ? normalizeVersion(found.latestVersion)
          : null,
        processedStatus: 'version_found',
      }
    }

    return {
      ...item,
      foundPackage: item.foundPackage || null,
      latestVersion: null,
      processedStatus: 'version_not_found',
    }
  } catch (err) {
    console.error(`Error looking up ${item.moduleName}:`, err.message)
    if (skipErrors) {
      return { ...item, processedStatus: 'version_lookup_error', error: err.message }
    }
    throw err
  }
}
