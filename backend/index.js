import dotenv from 'dotenv'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: `${__dirname}/.env` })

import express from 'express'
import XLSX from 'xlsx'
import multer from 'multer'
import cors from 'cors'
import fs from 'fs'
import rateLimit from 'express-rate-limit'

import jobManager from './services/jobManager.js'
import moduleLoadingService from './services/moduleLoadingService.js'
import excelService from './services/excelService.js'
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, isValidAiProvider } from './config/aiProviders.js'
import { getPartnerLabel, isValidPartnerId, partnersSearchForApi } from './config/adobeCommercePartners.js'
import logger from './utils/logger.js'

// ── Env validation ───────────────────────────────────────────────────────────
const REQUIRED_ENVS = []
const missingEnvs = REQUIRED_ENVS.filter((k) => !process.env[k])
if (missingEnvs.length > 0) {
  logger.error('Missing required environment variables at startup', { missing: missingEnvs })
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT || 3001

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin) return cb(null, true)
      if (allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error(`CORS: origin ${origin} not allowed`))
    },
    credentials: true,
  })
)

// ── File upload ───────────────────────────────────────────────────────────────
const ALLOWED_MIMETYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
])
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_BYTES || String(20 * 1024 * 1024), 10) // 20 MB

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const extOk = /\.(xlsx?)$/i.test(file.originalname)
    const mimeOk = ALLOWED_MIMETYPES.has(file.mimetype)
    if (!extOk && !mimeOk) {
      return cb(new Error('Only Excel (.xls, .xlsx) files are allowed'))
    }
    cb(null, true)
  },
})

// ── Rate limiting ─────────────────────────────────────────────────────────────
const evaluateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_EVALUATE || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many evaluation requests. Please wait before submitting again.' },
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
})

app.use(express.json())
app.use('/api/', apiLimiter)

// ── Helpers ───────────────────────────────────────────────────────────────────
function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/api/ai-providers', (_req, res) => {
  res.json({
    providers: AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, description: p.description })),
  })
})

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

// POST /api/evaluate
app.post('/api/evaluate', evaluateLimiter, upload.single('file'), async (req, res) => {
  const { projectId, limit, aiProvider, partnerId: rawPartnerId } = req.body
  const inputFile = req.file?.path

  if (!inputFile && !projectId) {
    return apiError(res, 400, 'MISSING_INPUT', 'Please provide either a file or a project ID')
  }

  const selectedProvider = (aiProvider || DEFAULT_AI_PROVIDER).toLowerCase().trim()
  if (!isValidAiProvider(selectedProvider)) {
    const allowed = AI_PROVIDERS.map((p) => p.id).join(', ')
    return apiError(res, 400, 'INVALID_PROVIDER', `Invalid AI provider. Must be one of: ${allowed}`)
  }

  const partnerId = (rawPartnerId == null || rawPartnerId === '' ? 'none' : String(rawPartnerId).trim()) || 'none'
  if (!isValidPartnerId(partnerId)) {
    return apiError(res, 400, 'INVALID_PARTNER', 'Invalid partner selection.')
  }

  const jobId = jobManager.createJob({
    projectId: projectId || null,
    isFileUpload: !!inputFile,
    aiProvider: selectedProvider,
    partnerId,
    partnerLabel: getPartnerLabel(partnerId),
  })

  res.json({ jobId, message: 'Processing started' })

  processEvaluationJob(jobId, { inputFile, projectId, limit, aiProvider: selectedProvider, partnerId }).catch(
    (err) => {
      logger.error('Unhandled error in job processing', { jobId, error: err.message })
      jobManager.setError(jobId, 'An internal error occurred')
    }
  )
})

async function processEvaluationJob(jobId, input) {
  try {
    const shouldAbort = () => jobManager.getJob(jobId)?.cancelled

    const modules = await moduleLoadingService.loadModules(input, (status, progress) => {
      jobManager.updateJob(jobId, { status, progress })
    })
    if (shouldAbort()) return

    const items = modules.map((mod) => ({
      rowIndex: mod.rowIndex,
      moduleName: mod.moduleName,
      status: 'pending',
    }))
    jobManager.updateJob(jobId, { total: modules.length, items })

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
    if (shouldAbort()) return

    jobManager.updateJob(jobId, { status: 'writing_results', progress: 90 })

    const outputFile = `/tmp/results/${jobId}_evaluated.xlsx`
    await excelService.generateReport(evaluated, outputFile, !input.inputFile)

    jobManager.setCompleted(jobId, outputFile)
    logger.info('Job completed', { jobId, provider: input.aiProvider })
  } catch (err) {
    logger.error('Job failed', { jobId, error: err.message })
    jobManager.setError(jobId, err.message)
  }
}

app.get('/api/job/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job) return apiError(res, 404, 'JOB_NOT_FOUND', 'Job not found')
  res.json(job)
})

app.post('/api/job/:jobId/cancel', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job) return apiError(res, 404, 'JOB_NOT_FOUND', 'Job not found')
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return apiError(res, 400, 'JOB_ALREADY_TERMINAL', `Job already ${job.status}`)
  }
  jobManager.setCancelled(req.params.jobId)
  res.json({ id: job.id, status: 'cancelled' })
})

app.get('/api/download/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job || !job.outputFile) return apiError(res, 404, 'OUTPUT_NOT_FOUND', 'Job or output not found')
  if (!fs.existsSync(job.outputFile)) return apiError(res, 404, 'FILE_NOT_FOUND', 'Output file not found')
  res.download(job.outputFile, `evaluation_${req.params.jobId}.xlsx`)
})

app.get('/api/results/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId)
  if (!job || !job.outputFile) return apiError(res, 404, 'OUTPUT_NOT_FOUND', 'Job or output not found')
  if (!fs.existsSync(job.outputFile)) return apiError(res, 404, 'FILE_NOT_FOUND', 'Output file not found')

  try {
    const wb = XLSX.readFile(job.outputFile)
    const sheetName = wb.SheetNames.includes('evaluation_results') ? 'evaluation_results' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws)

    const limit = parseInt(req.query.limit || '0', 10)
    const data = limit > 0 ? rows.slice(0, limit) : rows

    res.json({ jobId: job.id, rows: data })
  } catch (err) {
    logger.error('Failed to read results file', { jobId: req.params.jobId, error: err.message })
    return apiError(res, 500, 'RESULTS_READ_ERROR', 'Failed to read results')
  }
})

// GET /api/debug/swat/:projectId - Inspect raw SWAT API response (internal use only)
app.get('/api/debug/swat/:projectId', async (req, res) => {
  const { projectId } = req.params
  if (!projectId) return apiError(res, 400, 'MISSING_PROJECT_ID', 'Project ID is required')

  try {
    const ProjectExtensionsClient = (await import('./utils/projectExtensionsClient.js')).default
    const client = new ProjectExtensionsClient()
    const result = await client.fetchExtensions(projectId)

    res.json({
      projectId,
      modulesCount: result.modulesCount,
      parsedModules: result.modules,
      rawResponse: result.rawResponse,
    })
  } catch (err) {
    logger.error('Debug SWAT fetch failed', { projectId, error: err.message })
    return apiError(res, 500, 'SWAT_FETCH_ERROR', err.message)
  }
})

// ── Multer error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return apiError(res, 413, 'FILE_TOO_LARGE', `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`)
  }
  if (err.message?.startsWith('Only Excel')) {
    return apiError(res, 415, 'INVALID_FILE_TYPE', err.message)
  }
  if (err.message?.startsWith('CORS:')) {
    return apiError(res, 403, 'CORS_REJECTED', err.message)
  }
  logger.error('Unhandled middleware error', { error: err.message })
  return apiError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred')
})

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT}`)
  if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads', { recursive: true })
  if (!fs.existsSync('/tmp/results')) fs.mkdirSync('/tmp/results', { recursive: true })
})

// ── Temp file cleanup (runs every hour) ──────────────────────────────────────
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const MAX_FILE_AGE_MS = parseInt(process.env.MAX_TMP_AGE_MS || String(24 * 60 * 60 * 1000), 10)

function cleanOldTmpFiles(dir) {
  try {
    const now = Date.now()
    const files = fs.readdirSync(dir)
    let removed = 0
    for (const f of files) {
      const fp = `${dir}/${f}`
      try {
        const st = fs.statSync(fp)
        if (now - st.mtimeMs > MAX_FILE_AGE_MS) {
          fs.unlinkSync(fp)
          removed++
        }
      } catch {
        // skip files that can't be stat'd
      }
    }
    if (removed > 0) logger.info('Cleaned up temp files', { dir, removed })
  } catch {
    // non-fatal
  }
}

setInterval(() => {
  cleanOldTmpFiles('/tmp/uploads')
  cleanOldTmpFiles('/tmp/results')
  jobManager.cleanup(MAX_FILE_AGE_MS)
}, CLEANUP_INTERVAL_MS)
