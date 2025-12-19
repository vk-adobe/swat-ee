import XLSX from 'xlsx'

export function parseExcel(filePath) {
  try {
    const workbook = XLSX.readFile(filePath)
    const firstSheet = workbook.SheetNames[0]
    const ws = workbook.Sheets[firstSheet]

    // Robust header detection: read as rows, find the row that contains our expected headers
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })
    if (!rows || rows.length === 0) return []

    const expectedHeaderHints = [
      'Extension / Module Name',
      'Functionality & Business Details',
      'Enabled / Disabled',
      'ModuleName',
      'Description',
      'Enabled',
      'name',
      'description',
      'enabled',
    ]

    let headerIdx = 0
    let header = rows[0].map((c) => String(c || '').trim())

    // If the first row looks like a banner row (e.g., "Customer to Complete"), search next few rows for real headers
    const looksLikeHeaderRow = (r) => {
      const vals = (r || []).map((c) => String(c || '')).filter(Boolean)
      if (vals.length === 0) return false
      const score = vals.reduce((acc, v) => acc + (expectedHeaderHints.includes(v) ? 1 : 0), 0)
      return score >= 2
    }

    if (!looksLikeHeaderRow(rows[0])) {
      for (let i = 1; i < Math.min(rows.length, 10); i++) {
        if (looksLikeHeaderRow(rows[i])) {
          headerIdx = i
          header = rows[i].map((c) => String(c || '').trim())
          break
        }
      }
    }

    // Build objects from the detected header row
    const dataRows = rows.slice(headerIdx + 1)
    const objects = dataRows
      .map((r) => {
        const obj = {}
        for (let i = 0; i < header.length; i++) {
          const key = header[i] || `col_${i}`
          obj[key] = r[i] !== undefined ? r[i] : ''
        }
        // Drop rows that are entirely empty
        const hasValue = Object.values(obj).some((v) => String(v || '').trim().length > 0)
        return hasValue ? obj : null
      })
      .filter(Boolean)

    return objects
  } catch (err) {
    throw new Error(`Failed to parse Excel: ${err.message}`)
  }
}

export function normalizeModuleNames(rows) {
  return rows.map((row, idx) => {
    const moduleName = row['Extension / Module Name'] || row['ModuleName'] || row['name'] || ''
    const description = row['Functionality & Business Details'] || row['description'] || ''
    const enabled = row['Enabled / Disabled'] || row['enabled'] || 'Unknown'

    // Convert module name (e.g., Vendor_Module) to potential package names
    const packageCandidates = []
    if (moduleName) {
      const normalized = moduleName.trim()
      // Try Vendor_Module -> vendor/module
      if (normalized.includes('_')) {
        const [vendor, module] = normalized.split('_')
        packageCandidates.push(`${vendor.toLowerCase()}/${module.toLowerCase()}`)
        packageCandidates.push(`${vendor.toLowerCase()}-${module.toLowerCase()}`)
      }
      packageCandidates.push(normalized.toLowerCase())
    }

    return {
      rowIndex: idx,
      moduleName: moduleName.trim(),
      description: description.trim(),
      enabled: enabled.trim(),
      packageCandidates,
      foundPackage: null,
      latestVersion: null,
      latestUrl: null,
      recommendedAction: null,
      confidence: null,
      explanation: null,
      citations: [],
      processedStatus: 'pending',
    }
  })
}
