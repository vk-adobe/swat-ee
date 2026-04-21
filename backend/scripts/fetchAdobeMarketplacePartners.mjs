/**
 * Downloads the public partner directory from Adobe Commerce Marketplace.
 * API: GET https://commercemarketplace.adobe.com/partners-search/search
 * (same as the Partners page: https://commercemarketplace.adobe.com/partners)
 *
 * Usage: node scripts/fetchAdobeMarketplacePartners.mjs
 * Output: backend/data/adobeMarketplacePartners.json
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../data/adobeMarketplacePartners.json')
const SEARCH_URL = 'https://commercemarketplace.adobe.com/partners-search/search'
const PAGE_SIZE = 500

const STOP_WORDS = new Set([
  'the',
  'inc',
  'llc',
  'ltd',
  'gmbh',
  'ab',
  'bv',
  'spa',
  'plc',
  'corp',
  'co',
  'limited',
])

function deriveMatchPrefixes(hit) {
  const prefixes = new Set()
  const name = (hit.name || '').trim()
  const sn = (hit.screen_name || '').trim()

  const words = name.split(/[\s,&]+/).filter(Boolean)
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z0-9]/g, '')
    if (clean.length < 2) continue
    if (/^\d+$/.test(clean)) continue
    if (STOP_WORDS.has(clean.toLowerCase())) continue
    const cap = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
    prefixes.add(cap)
    break
  }

  // Simple marketplace slug → likely module vendor (e.g. amasty)
  if (sn && /^[a-z][a-z0-9]{1,40}$/i.test(sn)) {
    const p = sn.charAt(0).toUpperCase() + sn.slice(1).toLowerCase()
    prefixes.add(p)
  }

  return [...prefixes]
}

function partnerIdFromHit(hit) {
  const sn = (hit.screen_name || '').trim()
  if (!sn) return `id-${hit.id}`
  return sn
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `id-${hit.id}`
}

async function fetchPage(from) {
  const url = new URL(SEARCH_URL)
  url.searchParams.set('from', String(from))
  url.searchParams.set('size', String(PAGE_SIZE))

  const res = await fetch(url.href, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ExtensionEvaluatorCatalog/1.0 (partner directory sync; open)',
    },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.error || 'API returned success=false')
  }
  return json
}

async function main() {
  const first = await fetchPage(0)
  const total = first.total
  const allHits = [...(first.hits || [])]

  for (let from = allHits.length; from < total; from += PAGE_SIZE) {
    const page = await fetchPage(from)
    allHits.push(...(page.hits || []))
    console.info(`Fetched ${allHits.length} / ${total}…`)
    await new Promise((r) => setTimeout(r, 120))
  }

  const seen = new Set()
  const partners = []

  for (const hit of allHits) {
    const id = partnerIdFromHit(hit)
    if (seen.has(id)) continue
    seen.add(id)

    partners.push({
      id,
      label: (hit.name || id).trim(),
      screenName: hit.screen_name || '',
      partnerLevel: hit.partner_level || '',
      matchPrefixes: deriveMatchPrefixes(hit),
    })
  }

  const catalog = {
    schemaVersion: 1,
    source: SEARCH_URL,
    marketplacePartnersUrl: 'https://commercemarketplace.adobe.com/partners',
    generatedAt: new Date().toISOString(),
    total: partners.length,
    partners,
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify(catalog, null, 2), 'utf8')
  console.info(`Wrote ${OUT} (${partners.length} partners)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
