import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const FALLBACK_AI_PROVIDERS = [
  { id: 'adobe_llm', label: 'Adobe LLM' },
  { id: 'perplexity', label: 'Perplexity (Sonar)' },
  { id: 'openai', label: 'ChatGPT (OpenAI)' },
  { id: 'openai_compatible', label: 'OpenAI-compatible API' },
]

import './index.css'
import {
  useEvaluationForm,
  useJobPolling,
  useEvaluationResults,
  useDownload,
} from './hooks'

function FieldLabel({ children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</span>
      {hint && <p className="mt-0.5 text-xs font-normal normal-case tracking-normal text-zinc-500">{hint}</p>}
    </label>
  )
}

function FormSectionCard({ icon, title, meta, badge, children, sectionClassName = '' }) {
  return (
    <section className={`form-section-card ${sectionClassName}`.trim()}>
      <div className="form-section-card__head">
        <div className="form-section-card__icon" aria-hidden>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="form-section-card__title">{title}</h3>
            {badge && <span className="form-section-card__badge">{badge}</span>}
          </div>
          {meta && <p className="form-section-card__meta">{meta}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function IconPartners() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.09 9.09 0 003.741-.479 3 3 0 004-4.11-6.886 6.886 0 01-1.107-1.678L12 4.5l-6.534 4.048a9.09 9.09 0 00-1.107 1.678 3 3 0 004 4.11A9.09 9.09 0 0018 18.72z" />
    </svg>
  )
}

function IconScope() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25a2.25 2.25 0 01-2.25 2.25H15.75a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
    </svg>
  )
}

function IconSpark() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg className="input-search-wrap__icon" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

// Form Component — partner list is queried server-side (large catalog); type to search, then pick.
function FormSection({ form, providerOptions, apiBase, onSubmit, error }) {
  const [partnerQuery, setPartnerQuery] = useState('')
  const [partnerHits, setPartnerHits] = useState([{ id: 'none', label: 'None — evaluate all vendors' }])
  const [partnerLoading, setPartnerLoading] = useState(false)
  const [partnerSearchError, setPartnerSearchError] = useState(null)
  const [selectedPartnerRow, setSelectedPartnerRow] = useState(null)
  const [fileDragging, setFileDragging] = useState(false)

  const options = providerOptions?.length ? providerOptions : FALLBACK_AI_PROVIDERS.map((p) => ({ ...p, description: '' }))

  const baseUrl = apiBase ? `${apiBase}` : ''

  const onFilePicked = (file) => {
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      form.setFile(file)
    }
  }

  useEffect(() => {
    const q = partnerQuery.trim()
    if (q.length < 2) {
      setPartnerHits([{ id: 'none', label: 'None — evaluate all vendors' }])
      setPartnerSearchError(null)
      return
    }

    let cancelled = false
    const t = setTimeout(async () => {
      setPartnerLoading(true)
      setPartnerSearchError(null)
      try {
        const res = await axios.get(`${baseUrl}/api/partners`, {
          params: { q, limit: 200 },
          timeout: 60000,
        })
        const list = res.data?.partners
        const rows = Array.isArray(list) ? list : [{ id: 'none', label: 'None — evaluate all vendors' }]
        if (!cancelled) setPartnerHits(rows)
      } catch {
        if (!cancelled) {
          setPartnerSearchError('Could not search partners. Check that the backend is running.')
          setPartnerHits([{ id: 'none', label: 'None — evaluate all vendors' }])
        }
      } finally {
        if (!cancelled) setPartnerLoading(false)
      }
    }, 320)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [partnerQuery, baseUrl])

  const partnersForSelect = useMemo(() => {
    const h = partnerHits
    if (
      form.partnerId &&
      form.partnerId !== 'none' &&
      selectedPartnerRow?.id === form.partnerId &&
      !h.some((p) => p.id === form.partnerId)
    ) {
      return [selectedPartnerRow, ...h]
    }
    return h
  }, [partnerHits, form.partnerId, selectedPartnerRow])

  const matchCount = partnersForSelect.filter((p) => p.id !== 'none').length

  return (
    <div className="space-y-8">
      <div className="form-screen-intro">
        <div>
          <p className="form-screen-intro__step">Step 1 · Configure</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">Connect project or upload Excel</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
            Start here: enter a <span className="text-zinc-300">Project ID</span> or attach a spreadsheet — you need at least one. Optional partner and AI settings come after.
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-zinc-500">Required</p>
          <p className="mt-1 text-sm font-semibold text-sky-400/90">Project ID or Excel</p>
        </div>
      </div>

      <FormSectionCard
        icon={<IconScope />}
        title="Project ID or Excel upload"
        badge="Required"
        meta="Use Cloud project inventory via API, a local module list from Excel, or both if your workflow needs it."
        sectionClassName="form-section-card--primary"
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="space-y-5">
            <p className="text-xs font-medium text-zinc-400">
              Option A — Adobe Commerce <span className="text-zinc-200">project</span>
            </p>
            <div className="space-y-2">
              <FieldLabel hint="Cloud project identifier; extensions are loaded from the Adobe API when present.">Project ID</FieldLabel>
              <input
                type="text"
                value={form.projectId}
                onChange={(e) => form.setProjectId(e.target.value)}
                placeholder="e.g. acme-prod-evaluation"
                className="input-pro"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <FieldLabel hint="When using Project ID: cap how many extensions to evaluate; leave empty for all.">Evaluation limit</FieldLabel>
              <input
                type="number"
                min="1"
                value={form.limit}
                onChange={(e) => form.setLimit(e.target.value)}
                placeholder="All extensions"
                className="input-pro"
              />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-400">
              Option B — <span className="text-zinc-200">Excel</span> extension list
            </p>
            <FieldLabel hint="One column of Magento module names (Vendor_Module). .xlsx or .xls.">Upload spreadsheet</FieldLabel>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => onFilePicked(e.target.files?.[0])}
              className="hidden"
              id="fileInput"
            />
            <div
              className={`dropzone ${fileDragging ? 'dropzone--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setFileDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setFileDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setFileDragging(false)
                const f = e.dataTransfer?.files?.[0]
                onFilePicked(f)
              }}
            >
              <label htmlFor="fileInput" className="block cursor-pointer">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 text-sky-400 ring-1 ring-zinc-600/80">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-zinc-100">
                  {form.file ? form.file.name : 'Drop .xlsx / .xls here or click to browse'}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Shop export or module list</p>
                {form.file && <p className="mt-2 text-xs font-medium text-emerald-400/90">Attached</p>}
              </label>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/30 px-3 py-2.5 text-xs leading-relaxed text-amber-100/90">
          <span className="font-semibold text-amber-200/95">You must set a Project ID and/or attach a file</span> — the run button stays disabled until one of them is provided.
        </div>
      </FormSectionCard>

      <FormSectionCard
        icon={<IconPartners />}
        title="Partner filter (optional)"
        badge="Marketplace"
        meta="Skip version + AI steps for modules whose vendor matches the partner you select."
      >
        <div className="space-y-3">
          <FieldLabel hint="Searches the public Adobe Commerce Marketplace partner directory. Type at least 2 characters, then choose a result from the list.">
            Find partner
          </FieldLabel>
          <div className={`input-search-wrap ${partnerLoading ? 'partner-search-loading' : ''}`}>
            <IconSearch />
            <input
              type="search"
              value={partnerQuery}
              onChange={(e) => setPartnerQuery(e.target.value)}
              placeholder="e.g. silk, amasty, mageplaza"
              className="input-pro max-w-xl"
              autoComplete="off"
              aria-label="Search marketplace partners by name"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {partnerLoading && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 py-1 text-zinc-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                Searching…
              </span>
            )}
            {!partnerLoading && partnerQuery.trim().length < 2 && (
              <span className="text-zinc-500">Enter 2+ letters to query the directory (full list is not sent to the browser).</span>
            )}
            {!partnerLoading && partnerQuery.trim().length >= 2 && !partnerSearchError && (
              <span className="rounded-full bg-zinc-800/80 px-2.5 py-1 text-zinc-300">
                {matchCount} match{matchCount === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          {partnerSearchError && <p className="text-xs text-amber-400">{partnerSearchError}</p>}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Selection</span>
            <select
              value={form.partnerId}
              onChange={(e) => {
                const id = e.target.value
                form.setPartnerId(id)
                const row = partnersForSelect.find((p) => p.id === id)
                if (row) setSelectedPartnerRow(row)
              }}
              className="input-pro max-w-xl"
              aria-label="Selected marketplace partner"
            >
              {partnersForSelect.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-zinc-600">
            Not listed? Keep <span className="text-zinc-400">None</span> — only profiles from the Marketplace are used for automatic vendor matching.
          </p>
        </div>
      </FormSectionCard>

      <FormSectionCard icon={<IconSpark />} title="AI engine" meta="Drives research, native-fit reasoning, and written recommendations.">
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((opt) => {
            const active = form.aiProvider === opt.id
            const sub = opt.description || ''
            return (
              <label key={opt.id} className="ai-option-card group" data-active={active}>
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="aiProvider"
                    value={opt.id}
                    checked={active}
                    onChange={(e) => form.setAiProvider(e.target.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 border-zinc-600 text-sky-500 focus:ring-sky-500/40"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${active ? 'text-zinc-50' : 'text-zinc-300'}`}>
                      {opt.label || opt.id}
                    </span>
                    {sub ? (
                      <span className={`mt-0.5 block text-xs leading-snug ${active ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {sub}
                      </span>
                    ) : null}
                  </span>
                </div>
              </label>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">
          <span className="font-medium text-zinc-400">Tip:</span> Adobe LLM expects{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">ADOBE_LLM_API_URL</code>{' '}
          &amp;{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">ADOBE_LLM_API_KEY</code> in{' '}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">backend/.env</code>.
        </p>
      </FormSectionCard>

      <div className="form-hint-strip">
        <span>
          <kbd>Tab</kbd> moves between fields
        </span>
        <span>Partner search queries the backend (no 5k-row dropdown in-page)</span>
        <span>Excel + Project ID can both be set; typical flows use one source</span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/50 px-4 py-3 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6">
        <button type="button" onClick={onSubmit} disabled={!form.isFormValid()} className="btn-primary w-full text-[15px]">
          Generate evaluation report
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
          Produces a formatted Excel workbook with versions, AI rationale, and citations for stakeholder review.
        </p>
      </div>
    </div>
  )
}

// Processing Component
function ProcessingSection({ job, onCancel }) {
  const items = Array.isArray(job.items) ? job.items : []
  const total = job.total || items.length
  const processedCount = items.filter((item) => item.status && item.status !== 'pending').length
  const progressPct = typeof job.progress === 'number' ? Math.max(0, Math.min(100, job.progress)) : 0

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">In progress</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">Analyzing extensions</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {processedCount} of {total} items · {Math.round(progressPct)}% overall
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {job.projectId && (
            <span className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 font-mono text-xs text-zinc-200">
              Project · {job.projectId}
            </span>
          )}
          {job.aiProvider && (
            <span className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 font-mono text-xs text-zinc-300">
              Engine · {job.aiProvider}
            </span>
          )}
          {job.partnerLabel && (
            <span className="inline-flex items-center rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200/90">
              Skip vendor · {job.partnerLabel}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
          <span className="capitalize">{job.status.replace(/_/g, ' ')}</span>
          <span>{Math.round(progressPct)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {job.status === 'fetching_extensions' && (
        <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            Retrieving extension inventory…
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3">
        <p className="text-sm text-zinc-300">
          <span className="font-semibold text-zinc-100">Current step: </span>
          {job.status.replace(/_/g, ' ')}
        </p>
      </div>

      {items.length === 0 && <p className="text-sm text-zinc-500">Preparing extension list…</p>}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-zinc-700">
          <div className="max-h-[420px] divide-y divide-zinc-800 overflow-y-auto bg-zinc-950/40">
            {items.map((item) => (
              <div key={item.rowIndex} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate text-sm font-medium text-zinc-200">
                  {item.moduleName || `Row ${item.rowIndex + 1}`}
                </span>
                <span className="shrink-0 rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {item.status || 'pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={onCancel} className="btn-danger-outline w-full">
        Stop run
      </button>
    </div>
  )
}

// Results Table Component
function ResultsTable({ rows, visibleCount, onLoadMore }) {
  if (rows.length === 0) return <div className="text-sm text-zinc-500">No rows in this export.</div>

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

  const tabBtn = (mode, label) => (
    <button
      type="button"
      onClick={() => setViewMode(mode)}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        viewMode === mode ? 'bg-sky-600 text-white shadow-sm' : 'text-zinc-400 hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-zinc-500">
          Preview · {Math.min(visibleCount, rows.length)} of {rows.length} rows
        </p>
        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900/80 p-0.5">
          {tabBtn('table', 'Table')}
          {tabBtn('details', 'Cards')}
        </div>
      </div>

      {viewMode === 'table' && (
        <div className="overflow-hidden rounded-xl border border-zinc-700 shadow-lg shadow-black/20">
          <div className="max-h-[540px] overflow-auto">
            <table className="min-w-[1400px] text-xs">
              <thead className="sticky top-0 z-10 border-b border-zinc-700 bg-zinc-950 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="whitespace-nowrap px-3 py-3">
                      {formatLabel(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 bg-zinc-900/30">
                {rows.slice(0, visibleCount).map((r, idx) => (
                  <tr key={idx} className="hover:bg-zinc-800/40">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="max-w-[260px] whitespace-pre-wrap break-words px-3 py-2.5 align-top text-zinc-200"
                      >
                        {String(r[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'details' && (
        <div className="space-y-3">
          {rows.slice(0, visibleCount).map((r, idx) => (
            <div key={idx} className="rounded-xl border border-zinc-700 bg-zinc-950/50 p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {columns.map((col) => (
                  <div key={col} className="text-xs">
                    <div className="font-semibold uppercase tracking-wide text-zinc-500">{formatLabel(col)}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-zinc-200">{String(r[col] ?? '')}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length > visibleCount && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="text-sm font-semibold text-sky-400 underline decoration-sky-600 underline-offset-4 hover:text-sky-300 hover:decoration-sky-400"
          >
            Load more rows
          </button>
        </div>
      )}
    </>
  )
}

// Completed Component
function CompletedSection({ job, rows, visibleCount, loading, error, onLoadMore, onDownload, onReset }) {
  const errorRow = rows.find((r) => {
    const status = r.Status || r.processed_status || ''
    const explanation = r.Explanation || r.explanation || ''
    return String(status).toLowerCase().includes('ai_failed') || String(explanation).includes('Evaluation failed:')
  })
  const errorMessage = errorRow
    ? (errorRow.Explanation || errorRow.explanation || 'Evaluation failed')
    : ''

  return (
    <div className="space-y-8">
      <div className="text-center sm:text-left">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-950/60 text-emerald-400 ring-1 ring-emerald-800/80 sm:mx-0">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">Ready to share</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">Report generated</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
          Download the Excel workbook for workshops, SOW scoping, or stakeholder readouts. Use the preview below to scan
          key columns before export.
        </p>
      </div>

      {job && (
        <dl className="grid gap-3 rounded-xl border border-zinc-700 bg-zinc-950/50 px-4 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Job ID</dt>
            <dd className="mt-0.5 font-mono text-zinc-100">{job.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Extensions analyzed</dt>
            <dd className="mt-0.5 font-semibold text-zinc-100">{rows.length}</dd>
          </div>
          {job.aiProvider && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">AI engine</dt>
              <dd className="mt-0.5 font-mono text-zinc-200">{job.aiProvider}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Completed</dt>
            <dd className="mt-0.5 text-zinc-300">{job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</dd>
          </div>
        </dl>
      )}

      <div className="rounded-xl border border-zinc-700 bg-zinc-950/40 p-5 shadow-lg shadow-black/20">
        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">Executive preview</h3>
          <button type="button" onClick={onDownload} className="btn-primary shrink-0 py-2.5 text-sm">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Excel
          </button>
        </div>

        {!loading && !error && errorMessage && (
          <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            <span className="font-semibold text-amber-300">Note: </span>
            {errorMessage}
          </div>
        )}

        {loading && <p className="text-sm text-zinc-500">Loading results…</p>}
        {!loading && error && <p className="text-sm font-medium text-red-400">{error}</p>}
        {!loading && !error && <ResultsTable rows={rows} visibleCount={visibleCount} onLoadMore={onLoadMore} />}
      </div>

      <button type="button" onClick={onReset} className="btn-secondary w-full py-3 text-[15px]">
        Start another evaluation
      </button>
    </div>
  )
}

// Failed Component
function FailedSection({ error, onRetry }) {
  return (
    <div className="space-y-6 text-center sm:text-left">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-950/60 text-red-400 ring-1 ring-red-900/60 sm:mx-0">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-400/90">Could not complete</p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-100">Run stopped with an error</h2>
        <p className="mt-3 rounded-xl border border-red-900/50 bg-red-950/50 p-4 text-left text-sm text-red-200">{error}</p>
      </div>
      <button type="button" onClick={onRetry} className="btn-primary w-full">
        Try again
      </button>
    </div>
  )
}

// Main App
export default function App() {
  const defaultApiBase =
    typeof window !== 'undefined' && window.location && window.location.port !== '5173'
      ? 'http://localhost:3001'
      : ''
  const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || '').trim() || defaultApiBase

  const [providerOptions, setProviderOptions] = useState(null)

  useEffect(() => {
    const base = API_BASE ? `${API_BASE}` : ''
    axios
      .get(`${base}/api/ai-providers`)
      .then((res) => {
        const list = res.data?.providers
        if (Array.isArray(list) && list.length > 0) {
          setProviderOptions(
            list.map((p) => ({
              id: p.id,
              label: p.label,
              description: typeof p.description === 'string' ? p.description : '',
            }))
          )
        } else {
          setProviderOptions(FALLBACK_AI_PROVIDERS)
        }
      })
      .catch(() => setProviderOptions(FALLBACK_AI_PROVIDERS))
  }, [API_BASE])

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
    <div className="app-shell">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="mb-10 border-b border-zinc-800 pb-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 shadow-sm">
                Adobe Commerce
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
                Extension Evaluation
              </h1>
              <p className="mt-3 text-base leading-relaxed text-zinc-400">
                Purpose-built for discovery workshops and commerce roadmaps: reconcile installed extensions, surface
                current versions, and produce stakeholder-ready recommendations in one pass.
              </p>
            </div>
            <ul className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:w-80">
              {[
                {
                  t: 'AI rationale',
                  d: 'Replace vs. keep with native coverage context',
                  icon: (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.09z" />
                  ),
                },
                {
                  t: 'Version signals',
                  d: 'Packagist & GitHub aligned lookups',
                  icon: (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75v-6z" />
                  ),
                },
                {
                  t: 'Excel handoff',
                  d: 'Formatted export for sales & delivery teams',
                  icon: (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  ),
                },
              ].map((item) => (
                <li
                  key={item.t}
                  className="group flex gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3.5 shadow-sm backdrop-blur-sm transition-colors hover:border-zinc-700/90 hover:bg-zinc-900/70"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/90 text-sky-400/90 ring-1 ring-zinc-700/80 transition-colors group-hover:text-sky-300">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                      {item.icon}
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100">{item.t}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{item.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </header>

        <div className="app-card p-6 sm:p-8 lg:p-10">
          {polling.status === 'idle' && (
            <FormSection
              form={form}
              providerOptions={providerOptions}
              apiBase={API_BASE}
              onSubmit={handleUpload}
              error={polling.error}
            />
          )}

          {polling.status === 'processing' && polling.job && (
            <ProcessingSection job={polling.job} onCancel={polling.cancelJob} />
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

        <footer className="mt-12 border-t border-zinc-800 pt-8 text-center sm:text-left">
          <p className="text-sm font-medium text-zinc-300">How it works</p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
            Connect a project or upload a list. The service resolves package context, applies your chosen AI engine, and
            renders a structured workbook you can attach to proposals or internal QBR packs.
          </p>
          <p className="mt-6 text-xs text-zinc-600">
            Prototype · treat exported data according to your org&rsquo;s data-handling standards when sharing externally.
          </p>
        </footer>
      </div>
    </div>
  )
}
