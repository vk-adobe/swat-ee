import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'

function generateSample() {
  const rows = [
    {
      'Extension / Module Name': 'Vendor_SampleModule',
      'Functionality & Business Details': 'Sample module to demonstrate functionality',
      'Enabled / Disabled': 'Enabled',
    },
    {
      'Extension / Module Name': 'Other_Module',
      'Functionality & Business Details': 'Provides some extra analytics',
      'Enabled / Disabled': 'Disabled',
    },
  ]

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'extensions')

  const outDir = path.resolve('/tmp/sample')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'sample_extensions.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`Sample Excel written to ${outPath}`)
}

generateSample()
