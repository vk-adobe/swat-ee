import express from 'express'
import EvaluationService from '../services/evaluationService.js'

const router = express.Router()

/**
 * POST /api/evaluate
 * Start extension evaluation with Adobe IMS OAuth2 authentication
 *
 * Request body:
 * {
 *   "tokenUrl": "https://ims-na1.adobelogin.com/ims/token/v1",
 *   "extensionsUrl": "https://api.example.com/extensions",
 *   "clientId": "your-client-id",
 *   "clientSecret": "your-client-secret",
 *   "authorizationCode": "your-auth-code",
 *   "options": {
 *     "paginated": true,
 *     "pageSize": 100,
 *     "batchSize": 10
 *   }
 * }
 */
router.post('/evaluate', async (req, res) => {
  try {
    const { tokenUrl, extensionsUrl, clientId, clientSecret, authorizationCode, options } = req.body

    // Validate required fields
    const missing = []
    if (!extensionsUrl) missing.push('extensionsUrl')
    if (!clientId) missing.push('clientId')
    if (!clientSecret) missing.push('clientSecret')
    if (!authorizationCode) missing.push('authorizationCode')

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      })
    }

    // Create evaluation service with OAuth2 config
    const apiConfig = {
      tokenUrl: tokenUrl || 'https://ims-na1.adobelogin.com/ims/token/v1',
      extensionsUrl,
      clientId,
      clientSecret,
      authorizationCode,
    }
    const evaluationService = new EvaluationService(apiConfig)

    // Run evaluation with options
    const result = await evaluationService.runEvaluation(options || {})

    return res.json(result)
  } catch (err) {
    console.error('Evaluation endpoint error:', err)
    return res.status(500).json({
      success: false,
      message: 'Evaluation failed',
      error: err.message,
    })
  }
})

/**
 * GET /api/evaluate/status
 * Get evaluation job status (if implementing async jobs)
 */
router.get('/evaluate/status/:jobId', async (req, res) => {
  // Placeholder for job status checking
  return res.json({
    success: false,
    message: 'Not yet implemented',
  })
})

/**
 * POST /api/evaluate/export
 * Export evaluation results in specified format
 */
router.post('/evaluate/export', async (req, res) => {
  try {
    const { results, format = 'json' } = req.body

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid results data',
      })
    }

    const evaluationService = new EvaluationService({})
    const exported = evaluationService.exportResults(results, format)

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename=evaluation-results.csv')
      return res.send(exported)
    }

    return res.json({
      success: true,
      data: exported,
    })
  } catch (err) {
    console.error('Export error:', err)
    return res.status(500).json({
      success: false,
      message: 'Export failed',
      error: err.message,
    })
  }
})

export default router
