/**
 * True when the Magento-style module name encodes Core or Base as its own path segment
 * (e.g. Foo_Core, Bar_Base). Avoids substring false positives (e.g. "Score" containing "core").
 */
export function isCoreOrBaseModuleName(moduleName) {
  if (!moduleName || typeof moduleName !== 'string') return false
  return moduleName
    .split('_')
    .map((p) => p.toLowerCase())
    .some((segment) => segment === 'core' || segment === 'base')
}

/** First segment of a Magento module name (`Vendor_Module` → `vendor`). */
export function moduleVendorSegment(moduleName) {
  if (!moduleName || typeof moduleName !== 'string') return ''
  const i = moduleName.indexOf('_')
  if (i <= 0) return ''
  return moduleName.slice(0, i)
}

/**
 * When a “your organization” partner is selected, skip rows whose vendor segment matches
 * one of the canonical prefixes (case-insensitive), e.g. Amasty_* for Amasty.
 */
export function shouldSkipForPartnerSelection(moduleName, matchPrefixes) {
  if (!matchPrefixes?.length) return false
  const seg = moduleVendorSegment(moduleName).toLowerCase()
  if (!seg) return false
  return matchPrefixes.some((p) => seg === String(p || '').toLowerCase())
}

/** True when the full module name contains "Magento" (case-insensitive), e.g. Magento_Catalog or Foo_MagentoBar. */
export function hasMagentoInModuleName(moduleName) {
  if (!moduleName || typeof moduleName !== 'string') return false
  return moduleName.toLowerCase().includes('magento')
}
