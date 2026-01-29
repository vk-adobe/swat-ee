import dotenv from 'dotenv'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: `${__dirname}/../.env` })

async function getTokenAndFetchExtensions(projectId, apiEndpoint, apiMethod = 'GET', requestBody = null) {
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
    console.log('Token (first 50 chars):', accessToken.substring(0, 50) + '...')

    console.log('\n=== Step 2: Fetching Extensions ===')
    console.log('API Endpoint:', apiEndpoint)
    console.log('Project ID:', projectId)
    console.log('Method:', apiMethod)

    if (!apiEndpoint) {
      console.error('ERROR: API endpoint not provided!')
      process.exit(1)
    }

    const config = {
      method: apiMethod.toLowerCase(),
      url: apiEndpoint,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }

    // Add projectId to params or body based on method
    if (apiMethod.toUpperCase() === 'GET') {
      config.params = { projectId, ...config.params }
    } else if (requestBody) {
      config.data = { ...requestBody, projectId }
    } else {
      config.data = { projectId }
    }

    console.log('Sending request...')
    const response = await axios(config)

    console.log('\n✅ SUCCESS! Extensions fetched:')
    console.log(JSON.stringify(response.data, null, 2))

    return response.data

  } catch (error) {
    console.error('\n❌ ERROR:')
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Data:', JSON.stringify(error.response.data, null, 2))
    } else {
      console.error('Message:', error.message)
    }
    process.exit(1)
  }
}

// Get command line arguments
const projectId = process.argv[2] || 'test-project-123'
const apiEndpoint = process.argv[3] || null
const apiMethod = process.argv[4] || 'GET'

if (!apiEndpoint) {
  console.log('Usage: node testFetchExtensions.js <projectId> <apiEndpoint> [method]')
  console.log('Example: node testFetchExtensions.js my-project https://api.example.com/extensions GET')
  console.log('\nWaiting for API endpoint to be provided...')
  process.exit(1)
}

getTokenAndFetchExtensions(projectId, apiEndpoint, apiMethod)
