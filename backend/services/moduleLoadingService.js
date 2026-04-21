import { DEFAULT_AI_PROVIDER } from '../config/aiProviders.js'
import { getPartnerSkipPrefixes } from '../config/adobeCommercePartners.js'
import { parseExcel, normalizeModuleNames } from '../utils/parser.js'
import { lookupVersions } from '../utils/versionLookup.js'
import { evaluateExtensions } from '../utils/evaluator.js'
import ProjectExtensionsClient from '../utils/projectExtensionsClient.js'

/**
 * Unified module loading service for both file and projectId sources
 */
class ModuleLoadingService {
  /**
   * Load and normalize modules from either file or projectId
   * @param {object} input - { inputFile?, projectId?, limit? }
   * @param {function} onStatusUpdate - callback(status, progress)
   * @returns {Promise<Array>} - normalized modules ready for evaluation
   */
  async loadModules({ inputFile, projectId, limit }, onStatusUpdate) {
    let modules = []

    if (inputFile) {
      return this._loadFromFile(inputFile, onStatusUpdate)
    } else if (projectId) {
      return this._loadFromProjectId(projectId, limit, onStatusUpdate)
    } else {
      throw new Error('Either inputFile or projectId must be provided')
    }
  }

  /**
   * Load modules from Excel file
   * @private
   */
  _loadFromFile(inputFile, onStatusUpdate) {
    onStatusUpdate('parsing', 10)

    const rows = parseExcel(inputFile)
    if (rows.length === 0) {
      throw new Error('No data found in Excel file')
    }

    const maxRows = parseInt(process.env.MAX_ROWS_PER_REQUEST || 500)
    if (rows.length > maxRows) {
      throw new Error(`Sheet has ${rows.length} rows; max is ${maxRows}`)
    }

    onStatusUpdate('normalizing', 20)
    return normalizeModuleNames(rows)
  }

  /**
   * Load modules from Adobe ProjectId via API
   * @private
   */
  async _loadFromProjectId(projectId, limit, onStatusUpdate) {
    onStatusUpdate('fetching_extensions', 5)

    try {
      const extensionsClient = new ProjectExtensionsClient()
      const { modules: fetchedModules, modulesCount } = await extensionsClient.fetchExtensions(projectId)
      
      console.log(`Fetched ${modulesCount} modules for project ${projectId}`)

      onStatusUpdate('fetching_extensions', 15)
      onStatusUpdate('normalizing', 20)
      let modules = this._normalizeProjectModules(fetchedModules)

      // Apply limit after fetching
      if (limit) {
        const limitNum = parseInt(limit, 10)
        if (!isNaN(limitNum) && limitNum > 0 && limitNum < modules.length) {
          console.log(`Applied limit: evaluating ${limitNum} of ${modulesCount} extensions`)
          modules = modules.slice(0, limitNum)
        }
      }

      return modules
    } catch (err) {
      throw new Error(`Failed to fetch extensions for project ${projectId}: ${err.message}`)
    }
  }

  /**
   * Convert API-fetched modules to standard format
   * @private
   */
  _normalizeProjectModules(modules) {
    return modules.map((module, idx) => ({
      rowIndex: idx,
      moduleName: module.moduleName,
      description: module.composerName || module.moduleName,
      enabled: module.isEnabled ? 'Enabled' : 'Disabled',
      packageCandidates: module.composerName ? [module.composerName] : [],
      foundPackage: module.version || null,
      latestVersion: null,
      latestUrl: null,
      recommendedAction: null,
      confidence: null,
      explanation: null,
      citations: [],
      processedStatus: 'pending',
    }))
  }

  /**
   * Process modules through version lookup and AI evaluation
   * @param {Array} modules - loaded modules
   * @param {string} aiProvider - id from config/aiProviders.js (e.g. perplexity, openai, openai_compatible)
   * @param {function} onStatusUpdate - callback(status, progress)
   * @returns {Promise<Array>} - evaluated modules
   */
  async processModules(modules, aiProvider = DEFAULT_AI_PROVIDER, callbacks = {}) {
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error('No modules to process')
    }

    const onStatusUpdate = callbacks.onStatusUpdate
    const onProgress = callbacks.onProgress
    const onItemStatus = callbacks.onItemStatus
    const shouldAbort = callbacks.shouldAbort
    const partnerSkipPrefixes = getPartnerSkipPrefixes(callbacks.partnerId)

    if (onStatusUpdate) onStatusUpdate('looking_up_versions', 40)
    const withVersions = await lookupVersions(modules, { partnerSkipPrefixes })
    if (shouldAbort && shouldAbort()) return []

    if (onStatusUpdate) onStatusUpdate('evaluating', 60)
    const evaluated = await evaluateExtensions(withVersions, aiProvider, {
      onProgress,
      onItemStatus,
      shouldAbort,
      partnerSkipPrefixes,
    })

    return evaluated
  }
}

export default new ModuleLoadingService()
