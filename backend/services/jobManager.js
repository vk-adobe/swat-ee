import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import logger from '../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PERSIST_PATH = process.env.JOB_STORE_PATH || path.resolve(__dirname, '../data/jobs.json')
const PERSIST_INTERVAL_MS = 5000

class JobManager {
  constructor() {
    this.jobs = {}
    this._dirty = false
    this._loadFromDisk()
    setInterval(() => this._flushIfDirty(), PERSIST_INTERVAL_MS)
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _loadFromDisk() {
    try {
      if (!fs.existsSync(PERSIST_PATH)) return
      const raw = fs.readFileSync(PERSIST_PATH, 'utf8')
      const data = JSON.parse(raw)
      if (data && typeof data === 'object') {
        // Revive Date objects
        for (const job of Object.values(data)) {
          if (job.createdAt) job.createdAt = new Date(job.createdAt)
          if (job.updatedAt) job.updatedAt = new Date(job.updatedAt)
        }
        this.jobs = data
        logger.info('Loaded jobs from disk', { count: Object.keys(data).length })
      }
    } catch (err) {
      logger.warn('Could not load jobs from disk — starting fresh', { error: err.message })
      this.jobs = {}
    }
  }

  _flushIfDirty() {
    if (!this._dirty) return
    try {
      const dir = path.dirname(PERSIST_PATH)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(PERSIST_PATH, JSON.stringify(this.jobs, null, 2), 'utf8')
      this._dirty = false
    } catch (err) {
      logger.warn('Could not persist jobs to disk', { error: err.message })
    }
  }

  _markDirty() {
    this._dirty = true
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  createJob(input = {}) {
    const jobId = uuidv4()
    this.jobs[jobId] = {
      id: jobId,
      projectId: input.projectId || null,
      isFileUpload: input.isFileUpload || false,
      aiProvider: input.aiProvider || null,
      partnerId: input.partnerId || null,
      partnerLabel: input.partnerLabel || null,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      error: null,
      outputFile: null,
      cancelled: false,
    }
    this._markDirty()
    return jobId
  }

  updateJob(jobId, updates = {}) {
    if (!this.jobs[jobId]) throw new Error(`Job ${jobId} not found`)
    this.jobs[jobId] = { ...this.jobs[jobId], ...updates, updatedAt: new Date() }
    this._markDirty()
  }

  updateProgress(jobId, progress) {
    if (!this.jobs[jobId]) throw new Error(`Job ${jobId} not found`)
    this.jobs[jobId].progress = Math.min(100, Math.max(0, progress))
    this.jobs[jobId].updatedAt = new Date()
    this._markDirty()
  }

  setError(jobId, errorMessage) {
    this.updateJob(jobId, { status: 'failed', error: errorMessage, progress: 100 })
  }

  setCompleted(jobId, outputFile) {
    this.updateJob(jobId, { status: 'completed', outputFile, progress: 100 })
  }

  setCancelled(jobId) {
    this.updateJob(jobId, {
      status: 'cancelled',
      error: 'Job cancelled by user',
      progress: Math.min(this.jobs[jobId]?.progress || 0, 99),
      cancelled: true,
    })
  }

  getJob(jobId) {
    return this.jobs[jobId] || null
  }

  getAllJobs() {
    return Object.values(this.jobs)
  }

  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now()
    const toDelete = Object.entries(this.jobs)
      .filter(([, job]) => now - new Date(job.updatedAt).getTime() > maxAgeMs)
      .map(([id]) => id)

    toDelete.forEach((id) => delete this.jobs[id])

    if (toDelete.length > 0) {
      logger.info('Cleaned up old jobs', { count: toDelete.length })
      this._markDirty()
    }
  }
}

export default new JobManager()
