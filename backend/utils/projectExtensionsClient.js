import axios from 'axios'
import logger from './logger.js'

let cachedAccessToken = null
let cachedTokenExpiry = null

class ProjectExtensionsClient {
  constructor(config = {}) {
    this.authUrl = config.authUrl || process.env.AUTH_URL
    this.clientId = config.clientId || process.env.AUTH_CLIENT_ID
    this.clientSecret = config.clientSecret || process.env.AUTH_CLIENT_SECRET
    this.code = config.code || process.env.CODE
    this.graphqlEndpoint = config.graphqlEndpoint || process.env.SWAT_API_ENDPOINT || 'https://swat-api.adobe.io/query'
    this.apiKey = config.apiKey || process.env.AUTH_CLIENT_ID // x-api-key uses clientId

    this.accessToken = null
    this.tokenExpiry = null
  }

  async getAccessToken() {
    // Return cached token if valid
    if (cachedAccessToken && cachedTokenExpiry && Date.now() < cachedTokenExpiry) {
      this.accessToken = cachedAccessToken
      this.tokenExpiry = cachedTokenExpiry
      return cachedAccessToken
    }
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    try {
      const params = new URLSearchParams()
      params.append('grant_type', 'authorization_code')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('code', this.code)

      const response = await axios.post(this.authUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      })

      this.accessToken = response.data.access_token
      const expiresInRaw =
        response.data.expires_in ??
        response.data.expires_id ??
        response.data.expiresId
      const expiresIn = parseInt(expiresInRaw, 10) || 86400
      const bufferSeconds = 60
      this.tokenExpiry = Date.now() + Math.max(0, expiresIn - bufferSeconds) * 1000
      cachedAccessToken = this.accessToken
      cachedTokenExpiry = this.tokenExpiry

      return this.accessToken
    } catch (err) {
      logger.error('Token fetch failed', { error: err.message })
      throw new Error(`Failed to get access token: ${err.message}`)
    }
  }

  async fetchExtensions(projectId) {
    if (!projectId) {
      throw new Error('Project ID is required')
    }

    try {
      const accessToken = await this.getAccessToken()

      const graphqlQuery = `
        query GetExtensions($projectId: String!, $environment: String!) {
          info(
            criteria: {
              solutionsFilter: {
                adobeCommerce: {
                  projectId: $projectId,
                  environment: $environment
                }
              }
              codeFilter: { codeList: ["thirdPartyModules"] }
            }
            pageSize: 100
          ) {
            results {
              data
              code
              label
              entityMetadata {
                ... on AdobeCommerceEnvironment {
                  projectId
                  environment
                }
              }
            }
            pageInfo {
              page
              hasNextPage
            }
          }
        }
      `

      const response = await axios.post(
        this.graphqlEndpoint,
        {
          query: graphqlQuery,
          variables: { projectId, environment: 'production' },
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey
          },
          timeout: 15000
        }
      )

      if (response.data.errors) {
        throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`)
      }

      logger.debug('Raw SWAT API response', { projectId, payload: response.data })

      // Extract modules from response
      const results = response.data?.data?.info?.results || []
      const modules = this.parseModules(results)

      logger.info('SWAT API modules parsed', {
        projectId,
        resultCount: results.length,
        modulesCount: modules.length,
        sampleModule: modules[0] ?? null,
      })

      return {
        projectId,
        modulesCount: modules.length,
        modules,
        rawResponse: response.data,
      }
    } catch (err) {
      logger.error('Failed to fetch extensions', { error: err.message })
      throw err
    }
  }

  parseModules(results) {
    const modules = []

    results.forEach(result => {
      if (result.data) {
        try {
          const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
          const modulesList = data.modules || {}

          Object.entries(modulesList).forEach(([moduleName, moduleInfo]) => {
            modules.push({
              moduleName,
              composerName: moduleInfo.composer_name || '',
              version: moduleInfo.version || '',
              isEnabled: moduleInfo.is_enabled || false,
              type: moduleInfo.type || 'magento2-module',
              source: moduleInfo.source || 'unknown',
              installedAt: moduleInfo.installed_at || '',
              updatedAt: moduleInfo.updated_at || '',
              previousVersion: moduleInfo.prev_version || ''
            })
          })
        } catch (err) {
          logger.warn('Failed to parse module data', { error: err.message })
        }
      }
    })

    return modules
  }
}

export default ProjectExtensionsClient
