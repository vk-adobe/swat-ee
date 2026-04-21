import { v4 as uuidv4 } from 'uuid'

/**
 * Centralized job management service
 * Handles job lifecycle, status tracking, and updates
 */
class JobManager {
  constructor() {
    this.jobs = {}
  }

  /**
   * Create a new evaluation job
   * @param {object} input - { projectId?, isFileUpload? }
   * @returns {string} jobId
   */
  createJob(input = {}) {
    const jobId = uuidv4()
    
    this.jobs[jobId] = {
      id: jobId,
      projectId: input.projectId || null,
      isFileUpload: input.isFileUpload || false,
      aiProvider: input.aiProvider || null,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      error: null,
      outputFile: null,
      cancelled: false,
    }

    return jobId
  }

  /**
   * Update job status and progress
   * @param {string} jobId
   * @param {object} updates - { status?, progress?, error?, outputFile? }
   */
  updateJob(jobId, updates = {}) {
    if (!this.jobs[jobId]) {
      throw new Error(`Job ${jobId} not found`)
    }

    this.jobs[jobId] = {
      ...this.jobs[jobId],
      ...updates,
      updatedAt: new Date(),
    }
  }

  /**
   * Update only progress while keeping current status
   * @param {string} jobId
   * @param {number} progress - 0-100
   */
  updateProgress(jobId, progress) {
    if (!this.jobs[jobId]) {
      throw new Error(`Job ${jobId} not found`)
    }
    
    this.jobs[jobId].progress = Math.min(100, Math.max(0, progress))
    this.jobs[jobId].updatedAt = new Date()
  }

  /**
   * Mark job as failed
   * @param {string} jobId
   * @param {string} errorMessage
   */
  setError(jobId, errorMessage) {
    this.updateJob(jobId, {
      status: 'failed',
      error: errorMessage,
      progress: 100,
    })
  }

  /**
   * Mark job as completed
   * @param {string} jobId
   * @param {string} outputFile
   */
  setCompleted(jobId, outputFile) {
    this.updateJob(jobId, {
      status: 'completed',
      outputFile,
      progress: 100,
    })
  }

  /**
   * Mark job as cancelled
   * @param {string} jobId
   */
  setCancelled(jobId) {
    this.updateJob(jobId, {
      status: 'cancelled',
      error: 'Job cancelled by user',
      progress: Math.min(this.jobs[jobId]?.progress || 0, 99),
      cancelled: true,
    })
  }

  /**
   * Get job by ID
   * @param {string} jobId
   * @returns {object|null}
   */
  getJob(jobId) {
    return this.jobs[jobId] || null
  }

  /**
   * Get all jobs (useful for monitoring)
   * @returns {Array}
   */
  getAllJobs() {
    return Object.values(this.jobs)
  }

  /**
   * Clean up old jobs (optional: implement retention policy)
   * @param {number} maxAgeMs - jobs older than this are deleted
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now()
    const jobsToDelete = Object.entries(this.jobs)
      .filter(([_, job]) => now - job.updatedAt.getTime() > maxAgeMs)
      .map(([id]) => id)

    jobsToDelete.forEach(id => delete this.jobs[id])
    
    if (jobsToDelete.length > 0) {
      console.log(`Cleaned up ${jobsToDelete.length} old jobs`)
    }
  }
}

export default new JobManager()
