/**
 * Harvest extension listing links from major Adobe Commerce vendor storefronts
 * and optionally pull title/description snippets from product pages.
 *
 * Usage: node scripts/buildExtensionVendorCatalog.mjs [--detail-limit=0]
 * Output: backend/data/extensionVendorCatalog.json
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import { load } from 'cheerio'

import { TOP_EXTENSION_VENDORS, FETCH_HEADERS } from './vendorCatalogSources.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.resolve(__dirname, '../data/extensionVendorCatalog.json')

const SKIP_PATH_HINTS =
  /\/(cart|checkout|customer|login|register|contact|blog\/[^/]+$|privacy|terms)/i
/** Last path segment: marketing / nav pages that match \.html length heuristics but are not products */
const NAV_SLUGS = new Set([
  'about-us',
  'blog',
  'support',
  'partnership',
  'offers',
  'careers',
  'contact',
  'sitemap',
])
const MIN_TITLE_LEN = 3
const MAX_EXTENSIONS_PER_VENDOR = 400
function argInt(name, def) {
  const m = process.argv.join(' ').match(new RegExp(`${name}=(\\d+)`))
  return m ? parseInt(m[1], 10) : def
}
const detailLimit = argInt('--detail-limit', 40)

function normalizeUrl(href, base) {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

function slugFromUrl(u) {
  try {
    const p = new URL(u).pathname.replace(/\/$/, '')
    const seg = p.split('/').filter(Boolean).pop() || 'unknown'
    return seg.replace(/\.html?$/i, '').toLowerCase().slice(0, 120)
  } catch {
    return 'unknown'
  }
}

function dedupeExtensions(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    const k = e.productUrl
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 25000,
    headers: FETCH_HEADERS,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  })
  return String(res.data || '')
}

function harvestLinksFromListing(html, baseUrl, vendor) {
  const $ = load(html)
  const host = vendor.hostname.replace(/^www\./, '')
  const found = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    const abs = normalizeUrl(href, baseUrl)
    if (!abs) return
    let u
    try {
      u = new URL(abs)
    } catch {
      return
    }
    if (!u.hostname.replace(/^www\./, '').includes(host)) return
    if (SKIP_PATH_HINTS.test(u.pathname)) return
    const lastSeg = u.pathname.replace(/\/$/, '').split('/').pop() || ''
    const slugOnly = lastSeg.replace(/\.html?$/i, '').toLowerCase()
    if (NAV_SLUGS.has(slugOnly) && !/\/(magento|extension|product|shop)\//i.test(u.pathname)) return
    const looksProduct =
      /(\.html|\/magento|\/extension|\/shop\/|\/product)/i.test(u.pathname + u.search) ||
      u.pathname.match(/\/[a-z0-9-]{8,}\.html$/i)
    if (!looksProduct) return
    const title = $(el).text().trim().replace(/\s+/g, ' ')
    const snippet = title.length >= MIN_TITLE_LEN ? title : ''
    found.push({
      slug: slugFromUrl(abs),
      title: snippet || slugFromUrl(abs),
      productUrl: abs,
    })
  })

  return dedupeExtensions(found).slice(0, MAX_EXTENSIONS_PER_VENDOR)
}

async function fetchDetailSnippet(productUrl) {
  try {
    const html = await fetchHtml(productUrl)
    const $ = load(html)
    const og =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    const h1 = $('h1').first().text().trim()
    const p =
      $('article p, .product-info-main p, .product.attribute.description, main p')
        .first()
        .text()
        .trim()
        .slice(0, 800) || ''
    return {
      pageTitle: $('title').first().text().trim().slice(0, 200),
      h1: h1.slice(0, 300),
      description: (og || p).slice(0, 1200),
    }
  } catch {
    return { pageTitle: '', h1: '', description: '', fetchError: true }
  }
}

async function buildVendor(vendor) {
  const allExt = []
  for (const listUrl of vendor.listingUrls) {
    try {
      const html = await fetchHtml(listUrl)
      const batch = harvestLinksFromListing(html, listUrl, vendor)
      allExt.push(...batch)
    } catch (e) {
      console.warn(`[${vendor.id}] listing failed ${listUrl}:`, e.message)
    }
  }
  const merged = dedupeExtensions(allExt)

  let withDetails = merged
  if (detailLimit > 0 && merged.length) {
    const take = merged.slice(0, detailLimit)
    const rest = merged.slice(detailLimit)
    const details = []
    for (const ext of take) {
      const d = await fetchDetailSnippet(ext.productUrl)
      details.push({ ...ext, ...d, detailFetchedAt: new Date().toISOString() })
      await new Promise((r) => setTimeout(r, 200))
    }
    withDetails = [...details, ...rest.map((e) => ({ ...e, detailFetchedAt: null }))]
  }

  return {
    id: vendor.id,
    name: vendor.name,
    website: vendor.website,
    listingUrls: vendor.listingUrls,
    extensions: withDetails,
    extensionCount: withDetails.length,
    scrapedAt: new Date().toISOString(),
  }
}

async function main() {
  const catalog = {
    schemaVersion: 1,
    description:
      'Adobe Commerce extension vendors — listing harvest + optional per-page snippets from vendor websites. Used as offline context for evaluation.',
    generatedAt: new Date().toISOString(),
    vendorCount: TOP_EXTENSION_VENDORS.length,
    vendors: [],
  }

  for (const v of TOP_EXTENSION_VENDORS) {
    console.log(`Harvesting ${v.name}…`)
    try {
      catalog.vendors.push(await buildVendor(v))
    } catch (e) {
      console.error(`[${v.id}] failed:`, e.message)
      catalog.vendors.push({
        id: v.id,
        name: v.name,
        website: v.website,
        listingUrls: v.listingUrls,
        extensions: [],
        extensionCount: 0,
        error: e.message,
        scrapedAt: new Date().toISOString(),
      })
    }
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
  await fs.writeFile(OUT_PATH, JSON.stringify(catalog, null, 2), 'utf8')
  console.log(`Wrote ${OUT_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
