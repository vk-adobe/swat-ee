import React, { useEffect, useState } from 'react'
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
        <label className="block text-sm font-semibold text-gray-700 mb-2">Project ID</label>
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
        className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 hover:from-indigo-700 hover:via-blue-700 hover:to-cyan-600 disabled:from-gray-400 disabled:via-gray-400 disabled:to-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
      >
        Start Evaluation
      </button>
    </div>
  )
}

// Processing Component
function ProcessingSection({ job }) {
  const items = Array.isArray(job.items) ? job.items : []
  const total = job.total || items.length
  const processedCount = items.filter((item) => item.status && item.status !== 'pending').length
  const progressPct = typeof job.progress === 'number' ? Math.max(0, Math.min(100, job.progress)) : 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Evaluating Extensions</h2>
        <p className="text-sm text-gray-600">
          {processedCount} of {total} processed
        </p>
        {job.projectId && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700">
            <span className="font-semibold">Project ID</span>
            <span className="font-mono">{job.projectId}</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Status: {job.status.replace(/_/g, ' ')}</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-2 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {job.status === 'fetching_extensions' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            Fetching extensions from external API...
          </div>
          <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-2 bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
        <p className="text-sm text-gray-700">
          <strong>Current Step:</strong> {job.status.replace(/_/g, ' ')}
        </p>
      </div>

      {items.length === 0 && (
        <div className="text-sm text-gray-600">Preparing extension list…</div>
      )}

      {items.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {items.map((item) => (
              <div key={item.rowIndex} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm text-gray-800">{item.moduleName || `Row ${item.rowIndex + 1}`}</span>
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                  {item.status || 'pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Results Table Component
function ResultsTable({ rows, visibleCount, onLoadMore }) {
  if (rows.length === 0) return <div className="text-sm text-gray-600">No rows found.</div>

  const preferredColumns = [
    'Extension / Module Name', 'Functionality & Business Details', 'Enabled / Disabled',
    'Found Package', 'Latest Version', 'Latest URL', 'Recommended Action', 'Confidence %',
    'Native Alternative', 'Native Coverage', 'Upgrade Note', 'Explanation', 'Citations', 'Status',
    'found_package', 'latest_version', 'latest_url', 'recommended_action', 'confidence_pct',
    'native_alternative', 'native_coverage', 'upgrade_note', 'explanation', 'citations', 'processed_status'
  ]

  const rowKeys = Object.keys(rows[0] || {})
  const columns = [
    ...preferredColumns.filter((col) => rowKeys.includes(col)),
    ...rowKeys.filter((col) => !preferredColumns.includes(col)),
  ]

  const [viewMode, setViewMode] = useState('table')
  const formatLabel = (label) => {
    if (!label) return ''
    const titled = label
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
    return titled
      .replace(/\bId\b/g, 'ID')
      .replace(/\bUrl\b/g, 'URL')
      .replace(/\bAi\b/g, 'AI')
      .replace(/\bApi\b/g, 'API')
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-gray-500">
          Showing {Math.min(visibleCount, rows.length)} of {rows.length} rows
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded-full text-xs font-semibold ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Table View
          </button>
          <button
            onClick={() => setViewMode('details')}
            className={`px-3 py-1 rounded-full text-xs font-semibold ${viewMode === 'details' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Detail View
          </button>
        </div>
      </div>

      {viewMode === 'table' && (
        <div className="overflow-x-auto overflow-y-auto max-h-[540px] border rounded-lg shadow-sm">
          <table className="min-w-[1400px] text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="text-left font-semibold text-gray-700 px-3 py-2 border-b whitespace-nowrap">
                    {formatLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {rows.slice(0, visibleCount).map((r, idx) => (
                <tr key={idx} className="even:bg-gray-50">
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-2 align-top border-b text-gray-800 whitespace-pre-wrap break-words max-w-[260px]">
                      {String(r[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'details' && (
        <div className="space-y-3">
          {rows.slice(0, visibleCount).map((r, idx) => (
            <div key={idx} className="border rounded-lg p-4 bg-white shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {columns.map((col) => (
                  <div key={col} className="text-xs">
                    <div className="text-gray-500 font-semibold">{formatLabel(col)}</div>
                    <div className="text-gray-800 whitespace-pre-wrap break-words">{String(r[col] ?? '')}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
                className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold py-2 px-3 rounded-lg transition flex items-center gap-2 shadow-sm"
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
        className="w-full bg-gradient-to-r from-slate-200 to-slate-300 hover:from-slate-300 hover:to-slate-400 text-gray-800 font-bold py-3 px-4 rounded-lg transition"
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
        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition"
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
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Extension Evaluator</h1>
              <p className="text-gray-600 mt-1">Analyze Adobe Commerce extensions and get recommendations</p>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
              <span className="px-2 py-1 rounded-full bg-white border">AI‑assisted</span>
              <span className="px-2 py-1 rounded-full bg-white border">Packagist + GitHub</span>
              <span className="px-2 py-1 rounded-full bg-white border">Excel report</span>
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-xl shadow-sm border p-8">
          {polling.status === 'idle' && (
            <FormSection form={form} onSubmit={handleUpload} error={polling.error} />
          )}

          {polling.status === 'processing' && polling.job && (
            <ProcessingSection job={polling.job} />
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
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Upload an Excel file with extension names or provide a Project ID</p>
          <p className="mt-2">The evaluator will check latest versions and provide Adobe Commerce recommendations</p>
        </div>
      </div>
    </div>
  )
}
