import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './index.css'

export default function App() {
  // Detect API base for cases when index.html is opened directly without Vite proxy
  const defaultApiBase = typeof window !== 'undefined' && window.location && window.location.port !== '5173'
    ? 'http://localhost:3001'
    : ''
  const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || '').trim() || defaultApiBase

  const [file, setFile] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState('idle') // idle, uploading, processing, completed, failed
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)
  const [rows, setRows] = useState([])
  const [loadingResults, setLoadingResults] = useState(false)
  const [visibleCount, setVisibleCount] = useState(50)
  const [resultsError, setResultsError] = useState(null)

  const handleFileChange = (e) => {
    setFile(e.target.files[0])
    setError(null)
  }

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      setStatus('uploading')
      setError(null)
      // Let the browser set the Content-Type (including boundary) for FormData
      const response = await axios.post(`${API_BASE}/api/evaluate`, formData)
      setJobId(response.data.jobId)
      setStatus('processing')
      pollStatus(response.data.jobId)
    } catch (err) {
      console.error('Upload error:', err)
      setError(`Upload failed: ${err.response?.data?.error || err.message}`)
      setStatus('failed')
    }
  }

  const pollStatus = (id) => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`${API_BASE}/api/job/${id}`)
        setJob(response.data)
        setProgress(response.data.progress)

        if (response.data.status === 'completed') {
          setStatus('completed')
          clearInterval(interval)
          // Fetch JSON results for display
          fetchResults(id)
        } else if (response.data.status === 'failed') {
          setError(response.data.error)
          setStatus('failed')
          clearInterval(interval)
        }
      } catch (err) {
        clearInterval(interval)
      }
    }, 2000)
  }

  const fetchResults = async (id) => {
    try {
      setLoadingResults(true)
      setResultsError(null)
      const res = await axios.get(`${API_BASE}/api/results/${id}`)
      setRows(res.data.rows || [])
    } catch (e) {
      console.error('Failed to fetch results:', e)
      setResultsError(e?.response?.data?.error || e.message || 'Failed to load results')
    } finally {
      setLoadingResults(false)
    }
  }

  const handleDownload = () => {
    if (jobId) {
      window.location.href = `${API_BASE}/api/download/${jobId}`
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">📊 Extension Evaluator</h1>
          <p className="text-gray-600 text-lg">Analyze Adobe Commerce extensions and get recommendations</p>
        </div>

        {/* Main Card */}
          <div className="bg-white rounded-lg shadow-lg p-8">
          {status === 'idle' && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center cursor-pointer hover:bg-blue-50 transition">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  id="fileInput"
                />
                <label htmlFor="fileInput" className="cursor-pointer block">
                  <svg className="w-12 h-12 text-blue-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <p className="text-lg font-semibold text-gray-700">
                    {file ? file.name : 'Click to upload Excel file'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">or drag and drop (xlsx, xls)</p>
                </label>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={!file}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
              >
                Start Evaluation
              </button>
            </div>
          )}

          {status === 'uploading' && (
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-700 font-semibold">Uploading file...</p>
            </div>
          )}

          {status === 'processing' && job && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Processing: {job.status.replace('_', ' ')}</h2>
                <div className="w-full bg-gray-200 rounded-full h-4">
                  <div
                    className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-600 mt-2">{Math.round(progress)}% complete</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <p className="text-sm text-gray-700">
                  <strong>Current Step:</strong> {job.status.replace(/_/g, ' ')}
                </p>
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="space-y-6">
              <div>
                <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Evaluation Complete!</h2>
                <p className="text-gray-600">Your extension evaluation report is ready to download.</p>
              </div>

              {job && (
                <div className="bg-green-50 border border-green-200 p-4 rounded-lg text-left">
                  <p className="text-sm"><strong>Job ID:</strong> {job.id}</p>
                  <p className="text-sm"><strong>Status:</strong> {job.status}</p>
                  <p className="text-sm"><strong>Completed:</strong> {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</p>
                </div>
              )}

              {/* Inline Results Table */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-800">Results Preview</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownload}
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-3 rounded-lg transition flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Excel
                    </button>
                  </div>
                </div>

                {loadingResults && (
                  <div className="text-sm text-gray-600">Loading results…</div>
                )}

                {!loadingResults && resultsError && (
                  <div className="text-sm text-red-600">{resultsError}</div>
                )}

                {!loadingResults && !resultsError && rows.length === 0 && (
                  <div className="text-sm text-gray-600">No rows found.</div>
                )}

                {!loadingResults && rows.length > 0 && (
                  <div className="overflow-x-auto overflow-y-auto max-h-[540px] border rounded">
                    <table className="min-w-[1200px] text-sm">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          {[
                            'Extension / Module Name',
                            'Functionality & Business Details',
                            'Enabled / Disabled',
                            'found_package',
                            'latest_version',
                            'latest_url',
                            'recommended_action',
                            'confidence_pct',
                            'native_alternative',
                            'upgrade_note',
                            'explanation',
                            'citations',
                            'processed_status',
                          ].map((col) => (
                            <th key={col} className="text-left font-semibold text-gray-700 px-3 py-2 border-b">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, visibleCount).map((r, idx) => (
                          <tr key={idx} className="odd:bg-white even:bg-gray-50">
                            {[
                              'Extension / Module Name',
                              'Functionality & Business Details',
                              'Enabled / Disabled',
                              'found_package',
                              'latest_version',
                              'latest_url',
                              'recommended_action',
                              'confidence_pct',
                              'native_alternative',
                              'upgrade_note',
                              'explanation',
                              'citations',
                              'processed_status',
                            ].map((col) => (
                              <td key={col} className="px-3 py-2 align-top border-b text-gray-800 whitespace-pre-wrap break-words">
                                {String(r[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {rows.length > visibleCount && (
                  <div className="mt-3 text-center">
                    <button
                      onClick={() => setVisibleCount(visibleCount + 50)}
                      className="text-blue-600 hover:text-blue-700 font-semibold"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setStatus('idle')
                  setFile(null)
                  setJobId(null)
                  setProgress(0)
                  setError(null)
                  setJob(null)
                  setRows([])
                  setVisibleCount(50)
                }}
                className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-3 px-4 rounded-lg transition"
              >
                Evaluate Another File
              </button>
            </div>
          )}

          {status === 'failed' && (
            <div className="text-center space-y-6">
              <div>
                <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 className="text-2xl font-bold text-red-600 mb-2">Evaluation Failed</h2>
                <p className="text-gray-700 bg-red-50 border border-red-200 p-4 rounded-lg text-sm">{error}</p>
              </div>

              <button
                onClick={() => {
                  setStatus('idle')
                  setFile(null)
                  setJobId(null)
                  setProgress(0)
                  setError(null)
                  setJob(null)
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-600 text-sm">
          <p>Upload an Excel file with extension names and descriptions</p>
          <p className="mt-2">The evaluator will check latest versions and provide Adobe Commerce recommendations</p>
        </div>
      </div>
    </div>
  )
}
