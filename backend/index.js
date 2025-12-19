import dotenv from 'dotenv'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env from the backend folder explicitly so env is available even when
// the process is started from a different working directory
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: `${__dirname}/.env` })
import express from 'express'
import XLSX from 'xlsx'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import cors from 'cors'
import { parseExcel, normalizeModuleNames } from './utils/parser.js'
import { lookupVersions } from './utils/versionLookup.js'
import { evaluateExtensions } from './utils/evaluator.js'
import { writeResultsToExcel } from './utils/excelWriter.js'
import fs from 'fs'
import path from 'path'

const app = express()
const PORT = process.env.PORT || 3001
const upload = multer({ dest: '/tmp/uploads/' })

// Middleware
app.use(cors())
app.use(express.json())

// In-memory store for job status (in production, use a real DB)
const jobs = {}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Upload and process Excel file
app.post('/api/evaluate', upload.single('file'), async (req, res) => {
  const jobId = uuidv4()
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' })
  }

  const inputFile = req.file.path

  // Initialize job
  jobs[jobId] = {
    id: jobId,
    status: 'uploading',
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    error: null,
    outputFile: null,
  }

  res.json({ jobId, message: 'Processing started' })

  // Process asynchronously
  ;(async () => {
    try {
      // Helper to update job status/progress and set updatedAt
      const updateJob = (fields) => {
        jobs[jobId] = {
          ...jobs[jobId],
          ...fields,
          updatedAt: new Date(),
        }
      }

      updateJob({ status: 'parsing', progress: 10 })

      // Parse Excel
      const rows = parseExcel(inputFile)
      if (rows.length === 0) {
        throw new Error('No data found in Excel file')
      }

      const maxRows = parseInt(process.env.MAX_ROWS_PER_REQUEST || 500)
      if (rows.length > maxRows) {
        throw new Error(`Sheet has ${rows.length} rows; max is ${maxRows}`)
      }

      updateJob({ status: 'normalizing', progress: 20 })

      // Normalize module names
      const normalized = normalizeModuleNames(rows)

      updateJob({ status: 'looking_up_versions', progress: 40 })

      // Lookup latest versions
      const withVersions = await lookupVersions(normalized)

      updateJob({ status: 'evaluating', progress: 60 })

      // Evaluate with AI
      const evaluated = await evaluateExtensions(withVersions, (progress) => {
        jobs[jobId].progress = 60 + progress * 0.3
      })

      updateJob({ status: 'writing_results', progress: 90 })

      // Write results back to Excel
      const outputFile = `/tmp/results/${jobId}_evaluated.xlsx`
      await writeResultsToExcel(inputFile, evaluated, outputFile)

      updateJob({ status: 'completed', progress: 100, outputFile })

    } catch (err) {
      updateJob({ status: 'failed', error: err.message, progress: 100 })
    }
  })()
})

// Get job status
app.get('/api/job/:jobId', (req, res) => {
  const job = jobs[req.params.jobId]
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  res.json(job)
})

// Download result
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs[req.params.jobId]
  if (!job || !job.outputFile) {
    return res.status(404).json({ error: 'Job or output not found' })
  }
  if (!fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'File not found' })
  }
  res.download(job.outputFile, `evaluation_${req.params.jobId}.xlsx`)
})

// Return evaluated results as JSON (prefer evaluation_results sheet)
app.get('/api/results/:jobId', (req, res) => {
  const job = jobs[req.params.jobId]
  if (!job || !job.outputFile) {
    return res.status(404).json({ error: 'Job or output not found' })
  }
  if (!fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    const wb = XLSX.readFile(job.outputFile)
    const preferred = wb.SheetNames.includes('evaluation_results') ? 'evaluation_results' : wb.SheetNames[0]
    const ws = wb.Sheets[preferred]
    const rows = XLSX.utils.sheet_to_json(ws)
    const limit = parseInt(req.query.limit || '0', 10)
    const data = limit > 0 ? rows.slice(0, limit) : rows
    res.json({ jobId: job.id, rows: data })
  } catch (err) {
    res.status(500).json({ error: `Failed to read results: ${err.message}` })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  // Create directories
  if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads', { recursive: true })
  if (!fs.existsSync('/tmp/results')) fs.mkdirSync('/tmp/results', { recursive: true })
})
