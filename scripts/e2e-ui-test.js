#!/usr/bin/env node
import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001'
const SAMPLE = process.env.SAMPLE_FILE || '/tmp/sample/sample_extensions.xlsx'

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error('Sample file not found:', SAMPLE)
    process.exit(1)
  }

  console.log('Uploading sample file:', SAMPLE)
  const form = new FormData()
  form.append('file', fs.createReadStream(SAMPLE))

  const uploadRes = await axios.post(`${BACKEND}/api/evaluate`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  })

  const jobId = uploadRes.data.jobId
  console.log('Job started:', jobId)

  // poll
  let job
  for (let i = 0; i < 120; i++) {
    const res = await axios.get(`${BACKEND}/api/job/${jobId}`)
    job = res.data
    console.log(i, 'status:', job.status, 'progress:', job.progress)
    if (job.status === 'completed' || job.status === 'failed') break
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (job.status !== 'completed') {
    console.error('Job did not complete:', job)
    process.exit(2)
  }

  const outPath = path.join('/tmp', `ui_download_${jobId}.xlsx`)
  console.log('Downloading result to:', outPath)

  const downloadRes = await axios.get(`${BACKEND}/api/download/${jobId}`, {
    responseType: 'stream',
  })

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath)
    downloadRes.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })

  const stats = fs.statSync(outPath)
  console.log('Downloaded file size:', stats.size)
  console.log('E2E UI flow successful')
}

main().catch((err) => {
  console.error('E2E test failed:', err.message)
  process.exit(1)
})
