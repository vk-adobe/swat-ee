import axios from 'axios'

class ProjectExtensionsClient {
  constructor(config = {}) {
    this.authUrl = config.authUrl || process.env.AUTH_URL
    this.clientId = config.clientId || process.env.AUTH_CLIENT_ID
    this.clientSecret = config.clientSecret || process.env.AUTH_CLIENT_SECRET
    this.code = config.code || process.env.CODE
    this.graphqlEndpoint = config.graphqlEndpoint || 'https://swat-api.adobe.io/query'
    this.apiKey = config.apiKey || process.env.AUTH_CLIENT_ID // x-api-key uses clientId

    this.accessToken = null
    this.tokenExpiry = null
  }

  async getAccessToken() {
    // Return cached token if valid
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
      const expiresIn = parseInt(response.data.expires_in, 10) || 86400
      this.tokenExpiry = Date.now() + expiresIn * 1000

      return this.accessToken
    } catch (err) {
      console.error('Token fetch failed:', err.message)
      throw new Error(`Failed to get access token: ${err.message}`)
    }
  }

  async fetchExtensions(projectId) {
    if (!projectId) {
      throw new Error('Project ID is required')
    }

    try {
      const accessToken = await this.getAccessToken()

      const graphqlQuery = `{
  info(
    criteria: {
      solutionsFilter: {
        adobeCommerce: {
          projectId: "${projectId}",
          environment: "production"
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
}`

      const response = await axios.post(
        this.graphqlEndpoint,
        {
          query: graphqlQuery,
          variables: {}
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

      // Extract modules from response
      const results = response.data?.data?.info?.results || []
      const modules = this.parseModules(results)

      return {
        projectId,
        modulesCount: modules.length,
        modules,
        rawResponse: response.data
      }
    } catch (err) {
      console.error('Failed to fetch extensions:', err.message)
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
          console.warn('Failed to parse module data:', err.message)
        }
      }
    })

    return modules
  }
}

export default ProjectExtensionsClient
