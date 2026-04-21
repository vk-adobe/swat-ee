import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_PATH = path.resolve(__dirname, '../data/adobeMarketplacePartners.json')

/** When marketplace JSON is missing (e.g. before running the fetch script). */
const PARTNERS_FALLBACK = [
  { id: 'none', label: 'None — evaluate all vendors', matchPrefixes: [] },
  { id: 'amasty', label: 'Amasty', matchPrefixes: ['Amasty'] },
  { id: 'mageplaza', label: 'Mageplaza', matchPrefixes: ['Mageplaza'] },
  { id: 'mirasvit', label: 'Mirasvit', matchPrefixes: ['Mirasvit'] },
]

let cachedList = null
let cachedById = null

function loadRawCatalog() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    const fromFile = Array.isArray(parsed.partners) ? parsed.partners : []
    const head = [{ id: 'none', label: 'None — evaluate all vendors', matchPrefixes: [] }]
    return [...head, ...fromFile]
  } catch {
    return PARTNERS_FALLBACK
  }
}

function getList() {
  if (!cachedList) {
    cachedList = loadRawCatalog()
    cachedById = Object.fromEntries(
      cachedList.map((p) => [p.id, p])
    )
  }
  return cachedList
}

/**
 * Source: https://commercemarketplace.adobe.com/partners (via public search API).
 * Refresh: `npm run fetch-marketplace-partners` in backend.
 */
export function getPartnersCatalog() {
  return getList()
}

export function getPartnerById(partnerId) {
  if (!partnerId || partnerId === 'none') return null
  getList()
  return cachedById[partnerId] || null
}

/** No partner selected / explicit none → do not skip by vendor */
export function getPartnerSkipPrefixes(partnerId) {
  if (!partnerId || partnerId === 'none') return null
  const p = getPartnerById(partnerId)
  if (!p || !p.matchPrefixes?.length) return null
  return p.matchPrefixes
}

export function getPartnerLabel(partnerId) {
  if (!partnerId || partnerId === 'none') return null
  return getPartnerById(partnerId)?.label || null
}

export function isValidPartnerId(partnerId) {
  if (partnerId == null || partnerId === '') return true
  getList()
  return Boolean(cachedById[partnerId])
}

/** Full { id, label } for UI lists (large — from marketplace JSON). */
export function partnersListForApi() {
  const list = getList()
  const none = list.filter((p) => p.id === 'none')
  const rest = list
    .filter((p) => p.id !== 'none')
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
  return [...none, ...rest].map(({ id, label }) => ({ id, label }))
}

/** Lowercase alphanumerics only — matches "blueacorn" to "Blue Acorn Digital". */
export function normalizePartnerSearchKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '')
}

function tokenizePartnerText(s) {
  return String(s || '')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * Token / substring match so "silk" hits "Silk Commerce" but not accidental substrings in
 * collapsed "Muhammed Fasil…" (whole-string norm match was too loose).
 */
function partnerFieldsMatchQuery(p, qLower, qNorm) {
  const label = String(p.label || '')
  const id = String(p.id || '')
  const sn = String(p.screenName || '')

  if (label.toLowerCase().includes(qLower)) return { hit: true, score: 100 }
  if (id.toLowerCase().includes(qLower)) return { hit: true, score: 80 }
  if (sn.toLowerCase().includes(qLower)) return { hit: true, score: 70 }

  if (qNorm.length >= 2) {
    for (const tok of [...tokenizePartnerText(label), ...tokenizePartnerText(id), ...tokenizePartnerText(sn)]) {
      const low = tok.toLowerCase()
      if (low.includes(qLower)) return { hit: true, score: 72 }
      const tNorm = normalizePartnerSearchKey(tok)
      if (tNorm.includes(qNorm)) return { hit: true, score: 65 }
    }
    // Spaced names without separator when typed as one word: "blueacorn" → "Blue Acorn ICT"
    const lN = normalizePartnerSearchKey(label)
    const idN = normalizePartnerSearchKey(id)
    const snN = normalizePartnerSearchKey(sn)
    if (idN.includes(qNorm) || snN.includes(qNorm)) return { hit: true, score: 55 }
    if (lN.includes(qNorm) && qNorm.length >= 5) return { hit: true, score: 50 }
  }

  return { hit: false, score: 0 }
}

/**
 * Server-side search for the partner picker. Matches label, id, and screenName using both
 * substring and normalized "compact" keys so e.g. "blueacorn" can find "Blue Acorn …".
 */
export function partnersSearchForApi(query, limit = 150) {
  const raw = (query || '').trim()
  const all = getList().filter((p) => p.id !== 'none')
  if (!raw) {
    return all.sort((a, b) => a.label.localeCompare(b.label, 'en')).slice(0, limit)
  }

  const qLower = raw.toLowerCase()
  const qNorm = normalizePartnerSearchKey(raw)

  const scored = []
  for (const p of all) {
    const { hit, score } = partnerFieldsMatchQuery(p, qLower, qNorm)
    if (!hit) continue

    let boosted = score
    const label = String(p.label || '')
    if (label.toLowerCase().startsWith(qLower)) boosted += 20
    const firstTok = tokenizePartnerText(label)[0]
    if (firstTok && normalizePartnerSearchKey(firstTok).startsWith(qNorm) && qNorm.length >= 2) boosted += 15

    scored.push({ p, score: boosted })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.p.label.localeCompare(b.p.label, 'en')
  })

  return scored.slice(0, limit).map(({ p }) => ({ id: p.id, label: p.label }))
}
