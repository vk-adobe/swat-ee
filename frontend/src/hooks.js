import { useState, useCallback } from 'react'
import axios from 'axios'

/**
 * Custom hook for managing evaluation form state
 */
export function useEvaluationForm(apiBase) {
  const [file, setFile] = useState(null)
  const [projectId, setProjectId] = useState('')
  const [limit, setLimit] = useState('')
  const [aiProvider, setAiProvider] = useState('perplexity') // 'perplexity' or 'openai'

  const resetForm = useCallback(() => {
    setFile(null)
    setProjectId('')
    setLimit('')
    setAiProvider('perplexity')
  }, [])

  const isFormValid = () => !!(file || projectId.trim())

  const prepareFormData = useCallback(() => {
    const formData = new FormData()
    if (file) formData.append('file', file)
    if (projectId.trim()) formData.append('projectId', projectId.trim())
    if (limit.trim()) formData.append('limit', limit.trim())
    formData.append('aiProvider', aiProvider)
    return formData
  }, [file, projectId, limit, aiProvider])

  const submitForm = useCallback(async () => {
    const formData = prepareFormData()
    const response = await axios.post(`${apiBase}/api/evaluate`, formData)
    return response.data.jobId
  }, [apiBase, prepareFormData])

  return {
    file, setFile,
    projectId, setProjectId,
    limit, setLimit,
    aiProvider, setAiProvider,
    resetForm,
    isFormValid,
    submitForm,
  }
}

/**
 * Custom hook for managing job status and progress
 */
export function useJobPolling(apiBase) {
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState('idle') // idle, processing, completed, failed
  const [progress, setProgress] = useState(0)
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)

  const pollStatus = useCallback((id) => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`${apiBase}/api/job/${id}`)
        setJob(response.data)
        setProgress(response.data.progress)

        if (response.data.status === 'completed') {
          setStatus('completed')
          clearInterval(interval)
        } else if (response.data.status === 'failed') {
          setError(response.data.error)
          setStatus('failed')
          clearInterval(interval)
        } else {
          setStatus('processing')
        }
      } catch (err) {
        clearInterval(interval)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [apiBase])

  const startJob = useCallback(async (newJobId) => {
    setJobId(newJobId)
    setStatus('processing')
    setProgress(0)
    setError(null)
    pollStatus(newJobId)
  }, [pollStatus])

  const reset = useCallback(() => {
    setJobId(null)
    setStatus('idle')
    setProgress(0)
    setJob(null)
    setError(null)
  }, [])

  return {
    jobId, setJobId,
    status, setStatus,
    progress,
    job,
    error, setError,
    startJob,
    reset,
  }
}

/**
 * Custom hook for managing evaluation results
 */
export function useEvaluationResults(apiBase) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [visibleCount, setVisibleCount] = useState(50)

  const fetchResults = useCallback(async (jobId) => {
    if (!jobId) return

    try {
      setLoading(true)
      setError(null)
      const res = await axios.get(`${apiBase}/api/results/${jobId}`)
      setRows(res.data.rows || [])
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load results')
      console.error('Failed to fetch results:', err)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  const loadMore = useCallback(() => {
    setVisibleCount(prev => prev + 50)
  }, [])

  const reset = useCallback(() => {
    setRows([])
    setError(null)
    setVisibleCount(50)
  }, [])

  return {
    rows,
    loading,
    error,
    visibleCount,
    fetchResults,
    loadMore,
    reset,
  }
}

/**
 * Custom hook for file download
 */
export function useDownload(apiBase) {
  const download = useCallback((jobId) => {
    if (jobId) {
      window.location.href = `${apiBase}/api/download/${jobId}`
    }
  }, [apiBase])

  return { download }
}
