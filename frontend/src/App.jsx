import React, { useEffect } from 'react'
import axios from 'axios'
import './index.css'
import {
  useEvaluationForm,
  useJobPolling,
  useEvaluationResults,
  useDownload,
} from './hooks'

// Form Component
function FormSection({ form, onSubmit, error }) {
  return (
    <div className="space-y-6">
      {/* Project ID Input */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Project ID (Optional)</label>
        <input
          type="text"
          value={form.projectId}
          onChange={(e) => form.setProjectId(e.target.value)}
          placeholder="Enter your project ID"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
        />
      </div>

      {/* Limit Input */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Limit (Optional)</label>
        <input
          type="number"
          min="1"
          value={form.limit}
          onChange={(e) => form.setLimit(e.target.value)}
          placeholder="Leave empty to evaluate all"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
        />
        <p className="text-xs text-gray-500 mt-1">Only evaluates the first N extensions</p>
      </div>

      {/* AI Provider Selection */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">AI Provider</label>
        <div className="flex gap-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              name="aiProvider"
              value="perplexity"
              checked={form.aiProvider === 'perplexity'}
              onChange={(e) => form.setAiProvider(e.target.value)}
              className="w-4 h-4 text-blue-600"
            />
            <span className="ml-2 text-sm text-gray-700">Perplexity (Sonar)</span>
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              name="aiProvider"
              value="openai"
              checked={form.aiProvider === 'openai'}
              onChange={(e) => form.setAiProvider(e.target.value)}
              className="w-4 h-4 text-blue-600"
            />
            <span className="ml-2 text-sm text-gray-700">ChatGPT (OpenAI)</span>
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-1">Select which AI service to use for evaluation</p>
      </div>

      {/* File Upload */}
      <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center cursor-pointer hover:bg-blue-50 transition">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => form.setFile(e.target.files[0])}
          className="hidden"
          id="fileInput"
        />
        <label htmlFor="fileInput" className="cursor-pointer block">
          <svg className="w-12 h-12 text-blue-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <p className="text-lg font-semibold text-gray-700">
            {form.file ? form.file.name : 'Click to upload Excel file'}
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
        onClick={onSubmit}
        disabled={!form.isFormValid()}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
      >
        Start Evaluation
      </button>
    </div>
  )
}

// Processing Component
function ProcessingSection({ job, progress }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Processing: {job.status.replace(/_/g, ' ')}</h2>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div className="bg-blue-600 h-4 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="text-sm text-gray-600 mt-2">{Math.round(progress)}% complete</p>
      </div>
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
        <p className="text-sm text-gray-700">
          <strong>Current Step:</strong> {job.status.replace(/_/g, ' ')}
        </p>
      </div>
    </div>
  )
}

// Results Table Component
function ResultsTable({ rows, visibleCount, onLoadMore }) {
  if (rows.length === 0) return <div className="text-sm text-gray-600">No rows found.</div>

  const columns = [
    'Extension / Module Name', 'Functionality & Business Details', 'Enabled / Disabled',
    'found_package', 'latest_version', 'latest_url', 'recommended_action', 'confidence_pct',
    'native_alternative', 'upgrade_note', 'explanation', 'citations', 'processed_status'
  ]

  return (
    <>
      <div className="overflow-x-auto overflow-y-auto max-h-[540px] border rounded">
        <table className="min-w-[1200px] text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th key={col} className="text-left font-semibold text-gray-700 px-3 py-2 border-b whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, visibleCount).map((r, idx) => (
              <tr key={idx} className="odd:bg-white even:bg-gray-50">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2 align-top border-b text-gray-800 whitespace-pre-wrap break-words max-w-xs">
                    {String(r[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleCount && (
        <div className="mt-3 text-center">
          <button onClick={onLoadMore} className="text-blue-600 hover:text-blue-700 font-semibold">
            Load more
          </button>
        </div>
      )}
    </>
  )
}

// Completed Component
function CompletedSection({ job, rows, visibleCount, loading, error, onLoadMore, onDownload, onReset }) {
  return (
    <div className="space-y-6">
      <div>
        <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Evaluation Complete!</h2>
        <p className="text-gray-600">Your extension evaluation report is ready.</p>
      </div>

      {job && (
        <div className="bg-green-50 border border-green-200 p-4 rounded-lg text-left">
          <p className="text-sm"><strong>Job ID:</strong> {job.id}</p>
          <p className="text-sm"><strong>Total Extensions:</strong> {rows.length}</p>
          <p className="text-sm"><strong>Completed:</strong> {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</p>
        </div>
      )}

      {/* Results Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-800">Results Preview</h3>
          <button
            onClick={onDownload}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-3 rounded-lg transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Excel
          </button>
        </div>

        {loading && <div className="text-sm text-gray-600">Loading results…</div>}
        {!loading && error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && <ResultsTable rows={rows} visibleCount={visibleCount} onLoadMore={onLoadMore} />}
      </div>

      <button
        onClick={onReset}
        className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-3 px-4 rounded-lg transition"
      >
        Evaluate Another File
      </button>
    </div>
  )
}

// Failed Component
function FailedSection({ error, onRetry }) {
  return (
    <div className="text-center space-y-6">
      <div>
        <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-2xl font-bold text-red-600 mb-2">Evaluation Failed</h2>
        <p className="text-gray-700 bg-red-50 border border-red-200 p-4 rounded-lg text-sm">{error}</p>
      </div>
      <button
        onClick={onRetry}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition"
      >
        Try Again
      </button>
    </div>
  )
}

// Main App
export default function App() {
  const defaultApiBase = typeof window !== 'undefined' && window.location && window.location.port !== '5173'
    ? 'http://localhost:3001'
    : ''
  const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || '').trim() || defaultApiBase

  const form = useEvaluationForm(API_BASE)
  const polling = useJobPolling(API_BASE)
  const results = useEvaluationResults(API_BASE)
  const { download } = useDownload(API_BASE)

  // Auto-fetch results when completed
  useEffect(() => {
    if (polling.status === 'completed' && polling.jobId) {
      results.fetchResults(polling.jobId)
    }
  }, [polling.status, polling.jobId])

  const handleUpload = async () => {
    if (!form.isFormValid()) {
      polling.setError('Please select a file or enter a project ID')
      return
    }

    try {
      const jobId = await form.submitForm()
      await polling.startJob(jobId)
    } catch (err) {
      polling.setError(`Upload failed: ${err.response?.data?.error || err.message}`)
      polling.setStatus('failed')
    }
  }

  const handleReset = () => {
    polling.reset()
    form.resetForm()
    results.reset()
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
          {polling.status === 'idle' && (
            <FormSection form={form} onSubmit={handleUpload} error={polling.error} />
          )}

          {polling.status === 'processing' && polling.job && (
            <ProcessingSection job={polling.job} progress={polling.progress} />
          )}

          {polling.status === 'completed' && (
            <CompletedSection
              job={polling.job}
              rows={results.rows}
              visibleCount={results.visibleCount}
              loading={results.loading}
              error={results.error}
              onLoadMore={results.loadMore}
              onDownload={() => download(polling.jobId)}
              onReset={handleReset}
            />
          )}

          {polling.status === 'failed' && (
            <FailedSection error={polling.error} onRetry={handleReset} />
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-600 text-sm">
          <p>Upload an Excel file with extension names or provide a Project ID</p>
          <p className="mt-2">The evaluator will check latest versions and provide Adobe Commerce recommendations</p>
        </div>
      </div>
    </div>
  )
}
