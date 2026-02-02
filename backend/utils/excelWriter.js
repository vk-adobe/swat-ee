import XLSX from 'xlsx'
import fs from 'fs'
import { parseExcel } from './parser.js'

export async function writeResultsToExcel(inputFile, evaluated, outputFile) {
  try {
    // Use the same robust parser used by the pipeline so row indexes align
    const data = parseExcel(inputFile)

    // Append evaluation columns to original data
    const augmented = data.map((row, idx) => {
      const evalData = evaluated.find((e) => e.rowIndex === idx)
      return {
        ...row,
        found_package: evalData?.foundPackage || '',
        latest_version: (evalData?.latestVersion && String(evalData.latestVersion).match(/^v?\d{1,4}(\.\d{1,4}){1,3}([-.]?(?:p|patch|pl)\d+)?$/i)) ? evalData.latestVersion : '',
        latest_url: evalData?.latestUrl || '',
        recommended_action: evalData?.recommendedAction || '',
        confidence_pct: evalData?.confidence || '',
        native_alternative: evalData?.nativeAlternative || '',
        native_coverage: evalData?.nativeCoverage || '',
        upgrade_note: evalData?.upgradeNote || '',
        explanation: evalData?.explanation || '',
        citations: (evalData?.citations || []).join('; '),
        processed_status: evalData?.processedStatus || '',
      }
    })

    // Create output workbook with both sheets
    const outputWb = XLSX.utils.book_new()

    // Original data with evaluation columns
    const ws1 = XLSX.utils.json_to_sheet(augmented)
    XLSX.utils.book_append_sheet(outputWb, ws1, 'evaluation_results')

    // Summary statistics
    const summary = [
      {
        'Total Extensions': evaluated.length,
        'Keep': evaluated.filter((e) => e.recommendedAction === 'KEEP').length,
        'Update': evaluated.filter((e) => e.recommendedAction === 'UPDATE').length,
        'Replace with Native': evaluated.filter((e) => e.recommendedAction === 'REPLACE_WITH_NATIVE').length,
        'Remove': evaluated.filter((e) => e.recommendedAction === 'REMOVE').length,
        'Average Confidence': (evaluated.reduce((acc, e) => acc + (e.confidence || 0), 0) / evaluated.length).toFixed(1),
      },
    ]
    const ws2 = XLSX.utils.json_to_sheet(summary)
    XLSX.utils.book_append_sheet(outputWb, ws2, 'summary')

    // Write file
    XLSX.writeFile(outputWb, outputFile)

  } catch (err) {
    throw new Error(`Failed to write results: ${err.message}`)
  }
}
