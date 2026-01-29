import axios from 'axios'

const API_TIMEOUT = 10000
const TOKEN_CACHE_DURATION = 82800000 // ~23 hours

/**
 * External API client for fetching extension lists with Adobe IMS OAuth2 authentication
 */
class ExtensionApiClient {
  constructor(config = {}) {
    this.tokenUrl = config.tokenUrl || 'https://ims-na1.adobelogin.com/ims/token/v1'
    this.extensionsUrl = config.extensionsUrl || 'https://swat-api.adobe.io/query'
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.authorizationCode = config.authorizationCode
    this.customHeaders = config.customHeaders || {}
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiry = null

    // default GraphQL query (from prompt); can be overridden via options.query
    this.defaultQuery = `{
  info(      criteria: {     solutionsFilter: {       adobeCommerce: {           projectId: "6fla7372f455i",             environment: "production"         }      }      codeFilter: { codeList: ["thirdPartyModules"] }    }    pageSize: 100  ) {    results {      data      code      label      entityMetadata {        ... on AdobeCommerceEnvironment {          projectId          environment        }      }    }    pageInfo {      page      hasNextPage    }  }}`
  }

  /**
   * Fetch authentication token using OAuth2 authorization code flow
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    // Try to refresh token if refresh token exists
    if (this.refreshToken) {
      try {
        return await this.refreshAccessToken()
      } catch (err) {
        console.warn('Token refresh failed, attempting new authorization:', err.message)
      }
    }

    // Fallback to authorization code flow
    return this.authenticateWithAuthCode()
  }

  /**
   * Authenticate using authorization code (OAuth2 authorization_code grant)
   * @returns {Promise<string>} Access token
   */
  async authenticateWithAuthCode() {
    if (!this.authorizationCode) {
      throw new Error('Authorization code not provided')
    }

    try {
      const params = new URLSearchParams()
      params.append('grant_type', 'authorization_code')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('code', this.authorizationCode)

      const response = await axios.post(this.tokenUrl, params.toString(), {
        timeout: API_TIMEOUT,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.customHeaders },
      })

      return this.handleTokenResponse(response.data)
    } catch (err) {
      console.error('Authorization code authentication failed:', err.message)
      throw new Error(`OAuth2 authentication failed: ${err.message}`)
    }
  }

  /**
   * Refresh access token using refresh token (OAuth2 refresh_token grant)
   * @returns {Promise<string>} New access token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('Refresh token not available')

    try {
      const params = new URLSearchParams()
      params.append('grant_type', 'refresh_token')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('refresh_token', this.refreshToken)

      const response = await axios.post(this.tokenUrl, params.toString(), {
        timeout: API_TIMEOUT,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.customHeaders },
      })

      return this.handleTokenResponse(response.data)
    } catch (err) {
      console.error('Token refresh failed:', err.message)
      throw err
    }
  }

  /**
   * Handle OAuth2 token response and cache tokens
   * @param {Object} data - Token response data
   * @returns {string} Access token
   */
  handleTokenResponse(data) {
    if (!data?.access_token) throw new Error('No access token in response')
    this.accessToken = data.access_token
    if (data.refresh_token) this.refreshToken = data.refresh_token
    const expiresIn = parseInt(data.expires_in, 10) || 86400
    this.tokenExpiry = Date.now() + Math.min(expiresIn * 1000, TOKEN_CACHE_DURATION)
    return this.accessToken
  }

  /**
   * Fetch extensions from external API using access token
   * @param {Object} options - Query options (pagination, filters, etc.)
   * @returns {Promise<Array>} List of extensions with module names
   */
  async fetchExtensions(options = {}) {
    try {
      const accessToken = await this.getAccessToken()
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...this.customHeaders,
      }

      const body = {
        query: options.query || this.defaultQuery,
        variables: options.variables || {},
      }

      const response = await axios.post(this.extensionsUrl, body, {
        headers,
        timeout: API_TIMEOUT,
      })

      const raw = response.data || {}
      // Common GraphQL shapes: data.info.results or data.results
      const results =
        raw.data?.info?.results ||
        raw.data?.results ||
        raw.data?.query?.results ||
        raw.results ||
        []

      return this.normalizeExtensions(results)
    } catch (err) {
      console.error(`Failed to fetch extensions from ${this.extensionsUrl}:`, err.message)
      throw err
    }
  }

  /**
   * Fetch extensions with pagination support
   * @param {number} pageSize - Items per page
   * @returns {Promise<Array>} All extensions across pages
   */
  async fetchExtensionsPaginated(pageSize = 100) {
    const all = []
    let page = 1
    while (true) {
      const body = {
        query: this.defaultQuery,
        variables: { page, pageSize },
      }

      const accessToken = await this.getAccessToken()
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...this.customHeaders,
      }

      const response = await axios.post(this.extensionsUrl, body, {
        headers,
        timeout: API_TIMEOUT,
      })

      const raw = response.data || {}
      const results =
        raw.data?.info?.results ||
        raw.data?.results ||
        raw.data?.query?.results ||
        raw.results ||
        []

      const pageInfo =
        raw.data?.info?.pageInfo ||
        raw.data?.pageInfo ||
        raw.data?.query?.pageInfo ||
        raw.pageInfo ||
        { hasNextPage: false }

      const normalized = this.normalizeExtensions(results)
      all.push(...normalized)

      if (!pageInfo.hasNextPage) break
      page++
    }

    return all
  }

  /**
   * Normalize various result shapes from SWAT GraphQL into { moduleName, packageCandidates, ... }
   * @param {any} items - Raw API response data
   * @returns {Array} Normalized extensions
   */
  normalizeExtensions(items) {
    if (!Array.isArray(items)) return []
    return items.map((it) => {
      // SWAT item may be { data, code, label, entityMetadata }
      const data = it.data || {}
      const moduleName =
        data.moduleName ||
        data.module_name ||
        data.name ||
        data.module ||
        it.label ||
        it.code ||
        ''

      const packageCandidates =
        data.packageCandidates ||
        data.package_candidates ||
        data.packages ||
        it.packageCandidates ||
        it.package_candidates ||
        []

      return {
        moduleName,
        packageCandidates,
        source: it.source || data.source || 'swat',
        externalId: it.id || data.id || it.code || null,
        originalData: it,
      }
    })
  }

  /**
   * Clear cached tokens (useful for forcing re-authentication)
   */
  clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiry = null
  }

  /**
   * Set new authorization code (useful for updating credentials)
   * @param {string} code - New authorization code
   */
  setAuthorizationCode(code) {
    this.authorizationCode = code
    this.clearTokens()
  }

  /**
   * Check if token is still valid
   * @returns {boolean} True if token exists and not expired
   */
  isTokenValid() {
    return this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry
  }
}

export default ExtensionApiClient
