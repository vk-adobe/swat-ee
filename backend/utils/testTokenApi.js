import dotenv from 'dotenv'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: `${__dirname}/../.env` })

async function getToken() {
  try {
    const authUrl = process.env.AUTH_URL
    const clientId = process.env.AUTH_CLIENT_ID
    const clientSecret = process.env.AUTH_CLIENT_SECRET
    const code = process.env.CODE

    console.log('=== Token API Test ===')
    console.log('AUTH_URL:', authUrl)
    console.log('CLIENT_ID:', clientId)
    console.log('CLIENT_SECRET:', clientSecret ? `${clientSecret.substring(0, 10)}...` : 'NOT SET')
    console.log('CODE:', code ? `${code.substring(0, 20)}...` : 'NOT SET')
    console.log('')

    if (!authUrl || !clientId || !clientSecret || !code) {
      console.error('ERROR: Missing required environment variables!')
      process.exit(1)
    }

    console.log('Sending request to:', authUrl)
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('code', code)

    const response = await axios.post(authUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    })

    console.log('\n✅ SUCCESS! Token obtained:')
    console.log(JSON.stringify(response.data, null, 2))
    
    if (response.data.access_token) {
      console.log('\n✅ Access Token:', response.data.access_token.substring(0, 50) + '...')
    }

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

getToken()
