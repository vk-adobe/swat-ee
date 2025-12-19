import axios from 'axios'

const packageCache = {}
const lookupCache = {}

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

async function lookupPackagistVersion(packageName) {
  const cacheKey = `packagist:${packageName}`
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  try {
    const response = await axios.get(`https://repo.packagist.org/p/${packageName}.json`, {
      timeout: 5000,
    })
    const versions = response.data.packages[packageName] || []
    const latestStable = versions.find((v) => !v.version.includes('dev') && !v.version.includes('beta')) || versions[0]

    if (latestStable) {
      const result = {
        found: true,
        package: packageName,
        latestVersion: latestStable.version || 'unknown',
        latestUrl: `https://packagist.org/packages/${packageName}`,
      }
      lookupCache[cacheKey] = result
      return result
    }
  } catch (err) {
    // Not found or error
  }

  return { found: false, package: packageName }
}

async function searchPackagist(query) {
  const cacheKey = `packagist-search:${query}`
  if (lookupCache[cacheKey]) return lookupCache[cacheKey]

  try {
    const url = `https://packagist.org/search.json?q=${encodeURIComponent(query)}&type=magento2-module&per_page=10`
    const response = await axios.get(url, { timeout: 7000 })
    const results = response.data?.results || []
    lookupCache[cacheKey] = results
    return results
  } catch (err) {
    return []
  }
}

async function lookupGitHubVersion(vendor, repo) {
  const cacheKey = `github:${vendor}/${repo}`
  if (lookupCache[cacheKey]) {
    return lookupCache[cacheKey]
  }

  try {
    const response = await axios.get(`https://api.github.com/repos/${vendor}/${repo}/releases/latest`, {
      timeout: 5000,
    })
    const result = {
      found: true,
      package: `${vendor}/${repo}`,
      latestVersion: response.data.tag_name || response.data.name || 'unknown',
      latestUrl: response.data.html_url,
    }
    lookupCache[cacheKey] = result
    return result
  } catch (err) {
    // Not found
  }

  return { found: false }
}

export async function lookupVersions(normalized) {
  const results = []

  for (const item of normalized) {
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

    // 1) Exact Packagist hits over expanded candidates
    for (const candidate of expanded) {
      const hit = await lookupPackagistVersion(candidate)
      if (hit.found) {
        found = {
          foundPackage: hit.package,
          latestVersion: hit.latestVersion,
          latestUrl: hit.latestUrl,
        }
        break
      }
    }

    // 2) Packagist search fallback
    if (!found) {
      const query = [vendor, moduleKebab].filter(Boolean).join(' ')
      const searchResults = await searchPackagist(query || name)
      if (searchResults.length) {
        // Score results: prefer ones starting with vendor/ and containing moduleKebab
        const scored = searchResults
          .map((r) => {
            const n = (r.name || '').toLowerCase()
            let score = 0
            if (vendor && n.startsWith(`${vendor}/`)) score += 2
            if (moduleKebab && n.includes(moduleKebab)) score += 2
            if (n.includes('magento')) score += 1
            return { r, score }
          })
          .sort((a, b) => b.score - a.score)

        const best = scored[0]?.r
        if (best?.name) {
          const hit = await lookupPackagistVersion(best.name)
          if (hit.found) {
            found = {
              foundPackage: hit.package,
              latestVersion: hit.latestVersion,
              latestUrl: hit.latestUrl,
            }
          }
        }
      }
    }

    // 3) GitHub fallback for obvious repo patterns
    if (!found) {
      for (const candidate of expanded) {
        if (candidate.includes('/')) {
          const [v, repo] = candidate.split('/')
          const gh = await lookupGitHubVersion(v, repo)
          if (gh.found) {
            found = {
              foundPackage: gh.package,
              latestVersion: gh.latestVersion,
              latestUrl: gh.latestUrl,
            }
            break
          }
        }
      }
    }

    if (found) {
      results.push({
        ...item,
        foundPackage: found.foundPackage,
        latestVersion: found.latestVersion,
        latestUrl: found.latestUrl,
        processedStatus: 'version_found',
      })
    } else {
      results.push({
        ...item,
        processedStatus: 'version_not_found',
      })
    }
  }

  return results
}
