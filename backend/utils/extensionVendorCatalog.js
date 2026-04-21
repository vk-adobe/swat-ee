import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const EXTENSION_VENDOR_CATALOG_PATH = path.resolve(__dirname, '../data/extensionVendorCatalog.json')

let cache = null
let loadPromise = null

/**
 * Load extension vendor catalog JSON (built by scripts/buildExtensionVendorCatalog.mjs).
 * Safe if file missing — returns null.
 */
export async function loadExtensionVendorCatalog() {
  if (cache !== null) return cache
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fs.readFile(EXTENSION_VENDOR_CATALOG_PATH, 'utf8')
        cache = JSON.parse(raw)
        return cache
      } catch {
        cache = null
        return null
      }
    })()
  }
  return loadPromise
}

function moduleToVendorKebab(moduleName) {
  if (!moduleName || !moduleName.includes('_')) return { vendor: '', kebab: '' }
  const [v, ...rest] = moduleName.split('_')
  return {
    vendor: (v || '').toLowerCase(),
    kebab: rest.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  }
}

function strIncludesApprox(hay, needle) {
  if (!needle || !hay) return false
  return hay.includes(needle) || needle.split('-').every((p) => p.length > 2 && hay.includes(p))
}

/**
 * Return catalog entries that may match a Composer module name (e.g. Vendor_Module).
 * Used to enrich AI research with vendor-hosted descriptions.
 */
export async function findCatalogMatchesForModule(moduleName, limit = 5) {
  const catalog = await loadExtensionVendorCatalog()
  if (!catalog?.vendors?.length) return []

  const { vendor, kebab } = moduleToVendorKebab(moduleName)
  const vend = catalog.vendors.find((v) => v.id === vendor || v.name.toLowerCase().includes(vendor))
  if (!vend?.extensions?.length) return []

  const exts = vend.extensions
  const scored = exts.map((e) => {
    const title = String(e.title || '').toLowerCase()
    const slug = String(e.slug || '').toLowerCase()
    const url = String(e.productUrl || '').toLowerCase()
    const blob = `${title} ${slug} ${url}`
    let s = 0
    if (kebab && strIncludesApprox(blob, kebab)) s += 3
    if (kebab && slug.includes(kebab.replace(/-/g, ''))) s += 2
    return { e, s }
  })

  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e)
}

/**
 * Build a short text block for the research prompt from catalog matches.
 */
export function formatCatalogContextForPrompt(matches) {
  if (!matches?.length) return ''
  const lines = matches.map((m, i) => {
    const desc = m.description || m.h1 || m.pageTitle || ''
    return `${i + 1}. ${m.title || m.slug} — ${m.productUrl}\n   ${String(desc).slice(0, 500)}`
  })
  return `\nVendor catalog hints (from vendor website crawl):\n${lines.join('\n')}`
}

/** For cache invalidation when the JSON is regenerated. */
export async function getExtensionVendorCatalogMtimeKey() {
  try {
    const st = await fs.stat(EXTENSION_VENDOR_CATALOG_PATH)
    return String(Math.floor(st.mtimeMs))
  } catch {
    return '0'
  }
}
