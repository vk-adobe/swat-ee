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
import cors from 'cors'
import fs from 'fs'

// Services
import jobManager from './services/jobManager.js'
import moduleLoadingService from './services/moduleLoadingService.js'
import excelService from './services/excelService.js'
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, isValidAiProvider } from './config/aiProviders.js'
import { getPartnerLabel, isValidPartnerId, partnersSearchForApi } from './config/adobeCommercePartners.js'

const app = express()
const PORT = process.env.PORT || 3001
const upload = multer({ dest: '/tmp/uploads/' })

// Middleware
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// AI provider list for UI (keeps options in sync with backend validation)
app.get('/api/ai-providers', (req, res) => {
  res.json({
    providers: AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, description: p.description })),
  })
})

// Adobe Commerce partner search — use ?q= (avoid sending the full ~1MB list to the browser)
app.get('/api/partners', (req, res) => {
  const lim = Math.min(Math.max(parseInt(String(req.query.limit || '150'), 10) || 150, 1), 500)
  const q = req.query.q != null ? String(req.query.q).trim() : ''

  if (!q) {
    return res.json({
      partners: [{ id: 'none', label: 'None — evaluate all vendors' }],
      searchHint: 'Send ?q=your query to search the marketplace partner list.',
    })
  }

  const hits = partnersSearchForApi(q, lim)
  res.json({
    partners: [{ id: 'none', label: 'None — evaluate all vendors' }, ...hits.filter((p) => p.id !== 'none')],
  })
})

// POST /api/evaluate - Main evaluation endpoint
app.post('/api/evaluate', upload.single('file'), async (req, res) => {
  const { projectId, limit, aiProvider, partnerId: rawPartnerId } = req.body
  const inputFile = req.file?.path

  // Validate input
  if (!inputFile && !projectId) {
    return res.status(400).json({ error: 'Please provide either a file or a project ID' })
  }

  const selectedProvider = (aiProvider || DEFAULT_AI_PROVIDER).toLowerCase().trim()
  if (!isValidAiProvider(selectedProvider)) {
    const allowed = AI_PROVIDERS.map((p) => p.id).join(', ')
    return res.status(400).json({ error: `Invalid AI provider. Must be one of: ${allowed}` })
  }

  const partnerId = (rawPartnerId == null || rawPartnerId === '' ? 'none' : String(rawPartnerId).trim()) || 'none'
  if (!isValidPartnerId(partnerId)) {
    return res.status(400).json({ error: 'Invalid partner selection.' })
  }

  // Create job
  const jobId = jobManager.createJob({
    projectId: projectId || null,
    isFileUpload: !!inputFile,
    aiProvider: selectedProvider,
    partnerId,
    partnerLabel: getPartnerLabel(partnerId),
  })

  // Return job ID immediately
  res.json({ jobId, message: 'Processing started' })

  // Process asynchronously
  processEvaluationJob(jobId, { inputFile, projectId, limit, aiProvider: selectedProvider, partnerId })
})

/**
 * Main evaluation pipeline
 */
async function processEvaluationJob(jobId, input) {
  try {
    const shouldAbort = () => jobManager.getJob(jobId)?.cancelled

    // Step 1: Load modules from file or projectId
    const modules = await moduleLoadingService.loadModules(input, (status, progress) => {
      jobManager.updateJob(jobId, { status, progress })
    })
    if (shouldAbort()) {
      return
    }

    // Initialize per-module status tracking
    const items = modules.map((mod) => ({
      rowIndex: mod.rowIndex,
      moduleName: mod.moduleName,
      status: 'pending',
    }))
    jobManager.updateJob(jobId, { total: modules.length, items })

    // Step 2: Process modules (version lookup + AI evaluation)
    const evaluated = await moduleLoadingService.processModules(modules, input.aiProvider, {
      partnerId: input.partnerId,
      onStatusUpdate: (status, progress) => {
        if (status) {
          jobManager.updateJob(jobId, { status, progress })
        } else {
          jobManager.updateProgress(jobId, progress)
        }
      },
      onProgress: (progress) => {
        // Scale AI evaluation from 60-90% of total
        jobManager.updateProgress(jobId, 60 + progress * 30)
      },
      onItemStatus: ({ rowIndex, moduleName, status }) => {
        const job = jobManager.getJob(jobId)
        if (!job?.items) return
        const index = job.items.findIndex((item) => item.rowIndex === rowIndex)
        const next = [...job.items]
        if (index >= 0) {
          next[index] = { ...next[index], status, moduleName: next[index].moduleName || moduleName }
        } else {
          next.push({ rowIndex, moduleName, status })
        }
        jobManager.updateJob(jobId, { items: next })
      },
      shouldAbort,
    })
    if (shouldAbort()) {
      return
    }

    // Step 3: Generate Excel report
    jobManager.updateJob(jobId, { status: 'writing_results', progress: 90 })
    
    const outputFile = `/tmp/results/${jobId}_evaluated.xlsx`
    await excelService.generateReport(evaluated, outputFile, !input.inputFile)

    // Mark as completed
    jobManager.setCompleted(jobId, outputFile)
    console.log(`Job ${jobId} completed successfully with ${input.aiProvider} provider`)
  } catch (err) {
    console.error(`Job ${jobId} failed:`, err.message)
    jobManager.setError(jobId, err.message)
  }
}

// GET /api/job/:jobId - Check job status
app.get('/api/job/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  res.json(job)
})

// POST /api/job/:jobId/cancel - Cancel job
app.post('/api/job/:jobId/cancel', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return res.status(400).json({ error: `Job already ${job.status}` })
  }
  jobManager.setCancelled(req.params.jobId)
  res.json({ id: job.id, status: 'cancelled' })
})

// GET /api/download/:jobId - Download result file
app.get('/api/download/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job || !job.outputFile) {
    return res.status(404).json({ error: 'Job or output not found' })
  }
  if (!fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'File not found' })
  }
  res.download(job.outputFile, `evaluation_${req.params.jobId}.xlsx`)
})

// GET /api/results/:jobId - Get evaluated results as JSON
app.get('/api/results/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job || !job.outputFile) {
    return res.status(404).json({ error: 'Job or output not found' })
  }
  if (!fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    const wb = XLSX.readFile(job.outputFile)
    const sheetName = wb.SheetNames.includes('evaluation_results') ? 'evaluation_results' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
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
