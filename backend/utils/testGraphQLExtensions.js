import dotenv from 'dotenv'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: `${__dirname}/../.env` })

async function getTokenAndFetchExtensionsGraphQL(projectId) {
  try {
    console.log('=== Step 1: Getting Token ===')
    const authUrl = process.env.AUTH_URL
    const clientId = process.env.AUTH_CLIENT_ID
    const clientSecret = process.env.AUTH_CLIENT_SECRET
    const code = process.env.CODE

    if (!authUrl || !clientId || !clientSecret || !code) {
      console.error('ERROR: Missing required auth environment variables!')
      process.exit(1)
    }

    const tokenParams = new URLSearchParams()
    tokenParams.append('grant_type', 'authorization_code')
    tokenParams.append('client_id', clientId)
    tokenParams.append('client_secret', clientSecret)
    tokenParams.append('code', code)

    const tokenResponse = await axios.post(authUrl, tokenParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    })

    const accessToken = tokenResponse.data.access_token
    console.log('✅ Token obtained successfully')

    console.log('\n=== Step 2: Fetching Extensions via GraphQL ===')
    console.log('API Endpoint: https://swat-api.adobe.io/query')
    console.log('Project ID:', projectId)
    console.log('Method: POST (GraphQL)')

    // GraphQL query with projectId
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

    const requestBody = {
      query: graphqlQuery,
      variables: {}
    }

    console.log('\nSending GraphQL request...')
    const response = await axios.post('https://swat-api.adobe.io/query', requestBody, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-api-key': 'swat-access-for-evaluation-prd'
      },
      timeout: 15000
    })

    console.log('\n✅ SUCCESS! Extensions fetched:')
    console.log(JSON.stringify(response.data, null, 2))

    // Extract extensions from response
    if (response.data.data && response.data.data.info && response.data.data.info.results) {
      const extensions = response.data.data.info.results
      console.log(`\n📊 Found ${extensions.length} extensions`)
      console.log('\nExtensions:')
      extensions.forEach((ext, idx) => {
        console.log(`${idx + 1}. ${ext.label} (${ext.code})`)
      })
    }

    return response.data

  } catch (error) {
    console.error('\n❌ ERROR:')
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Data:', JSON.stringify(error.response.data, null, 2))
    } else if (error.request) {
      console.error('No response received:', error.message)
    } else {
      console.error('Message:', error.message)
    }
    process.exit(1)
  }
}

// Get projectId from command line
const projectId = process.argv[2] || '6fla7372f455i'

console.log('Testing GraphQL API with projectId:', projectId)
console.log('---\n')

getTokenAndFetchExtensionsGraphQL(projectId)
