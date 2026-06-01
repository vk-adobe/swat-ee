import XLSX from 'xlsx'

/**
 * Unified Excel generation service for both file-based and projectId-based evaluations
 */
class ExcelService {
  /**
   * Generate Excel report from evaluation results
   * @param {Array} evaluated - evaluated modules with recommendations
   * @param {string} outputFile - file path to write
   * @param {boolean} isProjectIdBased - whether this came from projectId API
   * @returns {Promise<void>}
   */
  async generateReport(evaluated, outputFile, isProjectIdBased = false) {
    if (!evaluated || evaluated.length === 0) {
      throw new Error('No evaluation results to write')
    }

    const workbook = XLSX.utils.book_new()

    // Sheet 1: Detailed results
    const resultsSheet = this._createResultsSheet(evaluated)
    XLSX.utils.book_append_sheet(workbook, resultsSheet, 'evaluation_results')

    // Sheet 2: Summary statistics
    const summarySheet = this._createSummarySheet(evaluated)
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'summary')

    // Sheet 3: Recommendations breakdown (optional)
    const breakdownSheet = this._createBreakdownSheet(evaluated)
    if (breakdownSheet) {
      XLSX.utils.book_append_sheet(workbook, breakdownSheet, 'breakdown')
    }

    // Write file
    XLSX.writeFile(workbook, outputFile)
  }

  /**
   * Create detailed results sheet
   * @private
   */
  _createResultsSheet(evaluated) {
    const data = evaluated.map(item => ({
      'Extension / Module Name': item.moduleName,
      'Functionality & Business Details': item.description || item.moduleName,
      'Enabled / Disabled': item.enabled || 'Unknown',
      'Found Package': item.foundPackage || '',
      /* Version comes from Packagist/GitHub lookup; avoid stripping valid Magento-style tags here */
      'Latest Version': item.latestVersion != null && String(item.latestVersion).trim() !== '' ? String(item.latestVersion) : '',
      'Latest URL': item.latestUrl != null && String(item.latestUrl).trim() !== '' ? String(item.latestUrl) : '',
      'Recommended Action': item.recommendedAction || '',
      'Confidence %': item.confidence || '',
      'Native Alternative': item.nativeAlternative || '',
      'Native Coverage': item.nativeCoverage || '',
      'Native on Adobe Commerce Cloud': item.commerceCloudAvailability || '',
      'Native on Adobe Commerce (on-premise)': item.commerceOnPremiseAvailability || '',
      'Cloud vs on-prem note': item.deploymentAvailabilityNote || '',
      'Upgrade Note': item.upgradeNote || '',
      'Explanation': item.explanation || '',
      'Citations': (item.citations || []).join('; '),
      'Status': item.processedStatus || '',
    }))

    return XLSX.utils.json_to_sheet(data)
  }

  /**
   * Create summary statistics sheet
   * @private
   */
  _createSummarySheet(evaluated) {
    const recommendations = this._countByRecommendation(evaluated)
    
    const summary = [{
      'Metric': 'Total Extensions',
      'Count': evaluated.length,
    }, {
      'Metric': 'KEEP',
      'Count': recommendations.KEEP,
      'Percentage': `${((recommendations.KEEP / evaluated.length) * 100).toFixed(1)}%`,
    }, {
      'Metric': 'UPDATE',
      'Count': recommendations.UPDATE,
      'Percentage': `${((recommendations.UPDATE / evaluated.length) * 100).toFixed(1)}%`,
    }, {
      'Metric': 'REPLACE_WITH_NATIVE',
      'Count': recommendations.REPLACE_WITH_NATIVE,
      'Percentage': `${((recommendations.REPLACE_WITH_NATIVE / evaluated.length) * 100).toFixed(1)}%`,
    }, {
      'Metric': 'REMOVE',
      'Count': recommendations.REMOVE,
      'Percentage': `${((recommendations.REMOVE / evaluated.length) * 100).toFixed(1)}%`,
    }, {
      'Metric': 'Average Confidence Score',
      'Count': `${(evaluated.reduce((acc, e) => acc + (e.confidence || 0), 0) / evaluated.length).toFixed(1)}%`,
    }]

    return XLSX.utils.json_to_sheet(summary)
  }

  /**
   * Create breakdown sheet with grouping by action
   * @private
   */
  _createBreakdownSheet(evaluated) {
    const recommendations = this._countByRecommendation(evaluated)
    if (Object.keys(recommendations).length === 0) return null

    const breakdown = Object.entries(recommendations).map(([action, count]) => ({
      'Recommendation': action,
      'Count': count,
      'Percentage': `${((count / evaluated.length) * 100).toFixed(1)}%`,
      'Average Confidence': this._averageConfidenceByRecommendation(evaluated, action),
    }))

    return XLSX.utils.json_to_sheet(breakdown)
  }

  /**
   * Count extensions by recommendation type
   * @private
   */
  _countByRecommendation(evaluated) {
    return evaluated.reduce((acc, ext) => {
      const action = ext.recommendedAction || 'UNKNOWN'
      acc[action] = (acc[action] || 0) + 1
      return acc
    }, {})
  }

  /**
   * Calculate average confidence for a recommendation type
   * @private
   */
  _averageConfidenceByRecommendation(evaluated, action) {
    const matching = evaluated.filter(e => e.recommendedAction === action)
    if (matching.length === 0) return 'N/A'
    const avg = matching.reduce((sum, e) => sum + (e.confidence || 0), 0) / matching.length
    return `${avg.toFixed(1)}%`
  }
}

export default new ExcelService()
