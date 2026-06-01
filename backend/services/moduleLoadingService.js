import { DEFAULT_AI_PROVIDER } from '../config/aiProviders.js'
import logger from '../utils/logger.js'
import { getPartnerSkipPrefixes } from '../config/adobeCommercePartners.js'
import {
  hasMagentoInModuleName,
  isCoreOrBaseModuleName,
  shouldSkipForPartnerSelection,
} from '../utils/moduleNameGuards.js'
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
   * @param {object} input - { inputFile?, projectId?, limit?, partnerId? }
   * @param {function} onStatusUpdate - callback(status, progress)
   * @returns {Promise<Array>} - normalized modules ready for evaluation
   */
  async loadModules({ inputFile, projectId, limit, partnerId }, onStatusUpdate) {
    let modules = []

    if (inputFile) {
      return this._loadFromFile(inputFile, onStatusUpdate)
    } else if (projectId) {
      return this._loadFromProjectId(projectId, limit, partnerId, onStatusUpdate)
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
  /**
   * Cap project modules by `limit`. When a partner is selected, that partner’s own Vendor_* modules
   * are excluded later in the pipeline — so the limit must count **eligible** rows (not the first
   * N rows from the API, which are often mostly the partner’s code).
   * @private
   */
  _applyProjectModuleLimit(modules, limit, partnerId) {
    const limitNum = parseInt(String(limit ?? '').trim(), 10)
    if (Number.isNaN(limitNum) || limitNum <= 0) {
      return modules
    }

    const prefixes = getPartnerSkipPrefixes(partnerId)
    if (!prefixes?.length) {
      if (limitNum < modules.length) {
        logger.info('Applied limit to modules (no partner exclusion)', { limitNum, total: modules.length })
        return modules.slice(0, limitNum)
      }
      return modules
    }

    const picked = []
    for (const m of modules) {
      if (picked.length >= limitNum) break
      const name = m.moduleName || ''
      if (isCoreOrBaseModuleName(name)) continue
      if (hasMagentoInModuleName(name)) continue
      if (shouldSkipForPartnerSelection(name, prefixes)) continue
      picked.push(m)
    }

    if (picked.length === 0) {
      throw new Error(
        'No extensions left to evaluate after applying the evaluation limit with your partner selected. ' +
          'The partner option skips that vendor’s own modules (Vendor_Module prefix); with your current limit, ' +
          'every candidate row was excluded. Clear the partner, raise the limit, or use a project list that includes other vendors.'
      )
    }

    logger.info('Applied partner-aware evaluation limit', {
      limitNum,
      selected: picked.length,
      totalFromProject: modules.length,
    })
    return picked.map((m, idx) => ({ ...m, rowIndex: idx }))
  }

  async _loadFromProjectId(projectId, limit, partnerId, onStatusUpdate) {
    onStatusUpdate('fetching_extensions', 5)

    try {
      const extensionsClient = new ProjectExtensionsClient()
      const { modules: fetchedModules, modulesCount } = await extensionsClient.fetchExtensions(projectId)
      
      logger.info('Fetched modules from SWAT', { projectId, modulesCount })

      onStatusUpdate('fetching_extensions', 15)
      onStatusUpdate('normalizing', 20)
      let modules = this._normalizeProjectModules(fetchedModules)

      if (limit) {
        modules = this._applyProjectModuleLimit(modules, limit, partnerId)
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
