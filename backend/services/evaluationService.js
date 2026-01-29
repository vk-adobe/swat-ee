import ExtensionApiClient from '../utils/extensionApiClient.js'
import { lookupVersions } from '../utils/versionLookup.js'

/**
 * Service to manage extension evaluation workflow with OAuth2 authentication
 */
class EvaluationService {
  constructor(apiConfig = {}) {
    this.apiClient = new ExtensionApiClient(apiConfig)
  }

  /**
   * Run complete evaluation: fetch extensions via OAuth2 and lookup versions
   * @param {Object} options - Evaluation options (paginated, pageSize, batchSize, etc.)
   * @returns {Promise<Object>} Evaluation results with stats
   */
  async runEvaluation(options = {}) {
    const startTime = Date.now()

    try {
      // 1) Fetch extensions from external API (with OAuth2 auth)
      console.log('Step 1: Authenticating and fetching extensions from external API...')
      const extensions = await this.fetchExtensions(options)
      console.log(`✓ Fetched ${extensions.length} extensions`)

      if (extensions.length === 0) {
        return {
          success: false,
          message: 'No extensions found',
          results: [],
          stats: { total: 0, versionFound: 0, versionNotFound: 0, errors: 0, duration: '0ms' },
        }
      }

      // 2) Lookup versions for all extensions
      console.log('Step 2: Looking up versions for extensions...')
      const versionLookupOptions = {
        batchSize: options.batchSize || 10,
        skipErrors: options.skipErrors !== false,
      }
      const results = await lookupVersions(extensions, versionLookupOptions)
      console.log(`✓ Version lookup completed`)

      // 3) Calculate statistics
      const stats = this.calculateStats(results)
      const duration = Date.now() - startTime

      console.log(`Step 3: Evaluation complete (${duration}ms)`)

      return {
        success: true,
        message: 'Evaluation completed successfully',
        results,
        stats: {
          ...stats,
          duration: `${duration}ms`,
        },
      }
    } catch (err) {
      console.error('✗ Evaluation failed:', err.message)
      return {
        success: false,
        message: `Evaluation failed: ${err.message}`,
        error: err.message,
        results: [],
        stats: { total: 0, versionFound: 0, versionNotFound: 0, errors: 0, duration: '0ms' },
      }
    }
  }

  /**
   * Fetch extensions using configured API client
   * @param {Object} options - Fetch options (pagination, filters)
   * @returns {Promise<Array>} Extensions list
   */
  async fetchExtensions(options = {}) {
    if (options.paginated) {
      return this.apiClient.fetchExtensionsPaginated(options.pageSize || 100)
    }
    return this.apiClient.fetchExtensions(options)
  }

  /**
   * Calculate evaluation statistics
   * @param {Array} results - Evaluation results
   * @returns {Object} Statistics
   */
  calculateStats(results) {
    const versionFound = results.filter((r) => r.processedStatus === 'version_found').length
    const versionNotFound = results.filter((r) => r.processedStatus === 'version_not_found').length
    const errors = results.filter((r) => r.processedStatus === 'version_lookup_error').length

    return {
      total: results.length,
      versionFound,
      versionNotFound,
      errors,
      successRate: results.length > 0 ? ((versionFound / results.length) * 100).toFixed(2) + '%' : '0%',
    }
  }

  /**
   * Export results in specified format
   * @param {Array} results - Evaluation results
   * @param {string} format - 'json' or 'csv'
   * @returns {string|Array} Formatted results
   */
  exportResults(results, format = 'json') {
    if (format === 'csv') {
      return this.resultsToCSV(results)
    }
    return JSON.stringify(results, null, 2)
  }

  /**
   * Convert results to CSV format
   * @param {Array} results - Results to convert
   * @returns {string} CSV content
   */
  resultsToCSV(results) {
    if (results.length === 0) return ''

    const headers = [
      'moduleName',
      'foundPackage',
      'latestVersion',
      'latestUrl',
      'processedStatus',
    ]
    const rows = results.map((r) =>
      headers.map((h) => {
        const value = r[h] || ''
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value
      })
    )

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  }
}

export default EvaluationService
