import axios from 'axios'

const packageCache = {}
const lookupCache = {}

// API endpoints and constants
const PACKAGIST_API_BASE = 'https://repo.packagist.org/p'
const PACKAGIST_WEB_BASE = 'https://packagist.org'
const PACKAGIST_SEARCH_URL = `${PACKAGIST_WEB_BASE}/search.json`
const GITHUB_API_BASE = 'https://api.github.com/repos'
const API_TIMEOUT = 5000
const SEARCH_TIMEOUT = 7000

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
  return version && !version.includes('dev') && !version.includes('beta')
}

/**
 * Lookup package version on Packagist by exact package name
 * @param {string} packageName - Package name (vendor/package format)
 * @returns {Promise<Object>} Result object with found flag and version info
 */
async function lookupPackagistVersion(packageName) {
  const cacheKey = getCacheKey('packagist', packageName)
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  try {
    const response = await axios.get(`${PACKAGIST_API_BASE}/${packageName}.json`, {
      timeout: API_TIMEOUT,
    })

    if (!response.data?.packages?.[packageName]) {
      return { found: false, package: packageName }
    }

    const versions = response.data.packages[packageName]
    const latestStable = versions.find(isStableVersion) || versions[0]

    if (latestStable?.version) {
      const result = {
        found: true,
        package: packageName,
        latestVersion: latestStable.version,
        latestUrl: `${PACKAGIST_WEB_BASE}/packages/${packageName}`,
      }
      lookupCache[cacheKey] = result
      return result
    }
  } catch (err) {
    // Not found or error
  }

  return { found: false, package: packageName }
}

/**
 * Search Packagist for Magento 2 modules
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
async function searchPackagist(query) {
  const cacheKey = getCacheKey('packagist-search', query)
  if (lookupCache[cacheKey]) return lookupCache[cacheKey]

  try {
    const url = `${PACKAGIST_SEARCH_URL}?q=${encodeURIComponent(query)}&type=magento2-module&per_page=10`
    const response = await axios.get(url, { timeout: SEARCH_TIMEOUT })
    const results = response.data?.results || []
    lookupCache[cacheKey] = results
    return results
  } catch (err) {
    return []
  }
}

/**
 * Lookup latest release on GitHub
 * @param {string} vendor - GitHub organization/user
 * @param {string} repo - Repository name
 * @returns {Promise<Object>} Result object with found flag and version info
 */
async function lookupGitHubVersion(vendor, repo) {
  const cacheKey = getCacheKey('github', vendor, repo)
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  try {
    const response = await axios.get(`${GITHUB_API_BASE}/${vendor}/${repo}/releases/latest`, {
      timeout: API_TIMEOUT,
    })

    if (response.data?.tag_name || response.data?.name) {
      const result = {
        found: true,
        package: `${vendor}/${repo}`,
        latestVersion: response.data.tag_name || response.data.name,
        latestUrl: response.data.html_url,
      }
      lookupCache[cacheKey] = result
      return result
    }
  } catch (err) {
    // Not found
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

/**
 * Lookup versions for normalized module list with batch processing
 * @param {Array} normalized - Normalized module list with moduleName and packageCandidates
 * @param {Object} options - Processing options (batchSize, skipErrors)
 * @returns {Promise<Array>} Results with version information
 */
export async function lookupVersions(normalized, options = {}) {
  const { batchSize = 10, skipErrors = true } = options
  const results = []

  // Process in batches to avoid rate limiting
  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((item) => lookupModuleVersion(item, skipErrors))
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
async function lookupModuleVersion(item, skipErrors = true) {
  try {
    const name = item.moduleName || ''
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

    // 2) Packagist search fallback
    if (!found) {
      const query = [vendor, moduleKebab].filter(Boolean).join(' ')
      const searchResults = await searchPackagist(query || name)
      if (searchResults.length) {
        const scored = searchResults
          .map((r) => ({ r, score: scoreSearchResult(r, vendor, moduleKebab) }))
          .sort((a, b) => b.score - a.score)

        const best = scored[0]?.r
        if (best?.name) {
          const hit = await lookupPackagistVersion(best.name)
          if (hit.found) {
            found = { foundPackage: hit.package, latestVersion: hit.latestVersion, latestUrl: hit.latestUrl }
          }
        }
      }
    }

    // 3) GitHub fallback
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

    return found
      ? { ...item, ...found, processedStatus: 'version_found' }
      : { ...item, processedStatus: 'version_not_found' }
  } catch (err) {
    console.error(`Error looking up ${item.moduleName}:`, err.message)
    if (skipErrors) {
      return { ...item, processedStatus: 'version_lookup_error', error: err.message }
    }
    throw err
  }
}
