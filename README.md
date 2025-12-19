# Extension Evaluator

Evaluate Adobe Commerce extensions, check latest versions, and get AI-powered recommendations for replacing with native features or updating.

## Features

- ✅ Upload Excel files with extension lists
- ✅ Auto-lookup latest versions from Packagist/GitHub
- ✅ AI-powered evaluation using OpenAI GPT
- ✅ Recommendations: Keep / Update / Replace with Native / Remove
- ✅ Download detailed evaluation report as Excel

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React + Vite + Tailwind CSS
- **AI**: OpenAI GPT-4o (or configurable)
- **File Processing**: XLSX (Excel)
- **APIs**: Packagist, GitHub, OpenAI

## Quick Start

### Prerequisites

- Node.js 16+
- npm or yarn
- OpenAI API key (optional for initial testing)

### 1. Setup Backend

```bash
cd /Users/vkhandelwal/test/projects/evaluator/backend
npm install
cp .env.example .env
# Edit .env and add your OpenAI API key (OPENAI_API_KEY)
npm run dev
```

Backend runs on `http://localhost:3001`

If you prefer to run the backend in the background and capture logs, you can run:

```bash
# from repository root
./scripts/start-dev.sh backend
tail -f /tmp/backend.log
```

### 2. Setup Frontend

```bash
cd /Users/vkhandelwal/test/projects/evaluator/frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

If Vite reports `Port 5173 is in use, trying another one...` you can start it on a fixed port and host:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Or run the combined dev helper (starts both backend and frontend in background and writes logs to /tmp):

```bash
./scripts/start-dev.sh
tail -f /tmp/frontend.log /tmp/backend.log
```

### 3. Use the App

1. Open `http://localhost:5173` in your browser
2. Upload an Excel file with columns:
   - `Extension / Module Name` (e.g., `Bss_Core`, `Experius_EmailCatcher`)
   - `Functionality & Business Details` (description of what it does)
   - `Enabled / Disabled` (optional status)
3. Click **Start Evaluation**
4. Wait for processing (shows progress bar)
5. Download the evaluated report as Excel

### Excel Input Format

Expected columns:
- `Extension / Module Name` — module identifier (e.g., `Vendor_Module`)
- `Functionality & Business Details` — free-text description
- `Enabled / Disabled` — status (Enabled/Disabled/Unknown)

Example rows:
```
Bss_Core | Magento 2 Bundle Product Option Image | Enabled
Experius_EmailCatcher | Log all Emails send by Magento | Enabled
Anowave_Ec | Magento 2 Google Analytics 4 Enhanced Ecommerce Tracking | Enabled
```

### Excel Output Format

The evaluated report includes:
- **evaluation_results sheet**: Original data + evaluation columns:
  - `found_package` — identified composer package
  - `latest_version` — latest stable version
  - `latest_url` — link to Packagist/GitHub
  - `recommended_action` — KEEP / UPDATE / REPLACE_WITH_NATIVE / REMOVE
  - `confidence_pct` — 0-100 confidence in recommendation
  - `explanation` — brief rationale
  - `citations` — links to documentation
  - `processed_status` — status code (version_found, ai_evaluated, etc.)

- **summary sheet**: Statistics (total, by action, average confidence)

## Environment Variables

### Backend (.env)

```
PORT=3001
OPENAI_API_KEY=sk-...your-key...
OPENAI_MODEL=gpt-4o
NODE_ENV=development
MAX_ROWS_PER_REQUEST=500
```

You can also switch AI providers. Supported options:

- `AI_PROVIDER=openai` (default)
- `AI_PROVIDER=perplexity` — requires `PERPLEXITY_API_KEY` to be set

Example:

```
AI_PROVIDER=perplexity
PERPLEXITY_API_KEY=pk-...your-key...
```

### Frontend (uses Vite proxy)

- Proxies `/api/*` to backend at `http://localhost:3001`
- No separate .env needed for development

## API Endpoints

### POST /api/evaluate
Upload and start evaluation.

**Request**: multipart form-data with `file` (Excel)

**Response**:
```json
{
  "jobId": "uuid",
  "message": "Processing started"
}
```

### GET /api/job/:jobId
Get job status and progress.

**Response**:
```json
{
  "id": "uuid",
  "status": "parsing|normalizing|looking_up_versions|evaluating|writing_results|completed|failed",
  "progress": 0-100,
  "error": null,
  "outputFile": "/tmp/results/uuid_evaluated.xlsx"
}
```

### GET /api/download/:jobId
Download the evaluated Excel file.

## How It Works

1. **Parse**: Read Excel, extract module names and descriptions
2. **Normalize**: Convert module names (e.g., `Vendor_Module`) to potential package identifiers
3. **Lookup**: Query Packagist and GitHub for latest versions and changelog URLs
4. **Evaluate**: Send module metadata + latest version info to OpenAI with prompt asking for:
   - Functionality summary
   - Whether it's available natively in Adobe Commerce
   - Recommendation (Keep / Update / Replace / Remove)
   - Confidence score (0-100)
   - Citations (links to docs)
5. **Write**: Append evaluation columns to original Excel and create summary sheet
6. **Deliver**: Provide download link

## Configuration & Customization

### Adjust AI Prompt
Edit `backend/utils/evaluator.js` → `adobeCommerceOOTBFeatures` and `evaluateExtensions()` prompt.

### Change OpenAI Model
Set `OPENAI_MODEL` in `.env` (e.g., `gpt-4`, `gpt-4.5-turbo`)

### Extend Version Lookup
Add more sources in `backend/utils/versionLookup.js` (Magento Marketplace, vendor websites, etc.)

### Adjust Rate Limits
Set `MAX_ROWS_PER_REQUEST` in `.env`

## Deployment

### Backend (Render, Heroku, AWS Lambda)
- Push code to Git repository
- Set environment variables (`OPENAI_API_KEY`, `PORT`)
- Deploy

### Frontend (Vercel, Netlify)
- Push code to Git
- Set backend URL (update proxy or set API base URL in App.jsx)
- Deploy

## Troubleshooting

**"No file provided"**
- Ensure you're uploading an Excel file (.xlsx or .xls)

**"Sheet has X rows; max is 500"**
- Your file exceeds the default limit; adjust `MAX_ROWS_PER_REQUEST` in backend `.env`

**"OpenAI API key not configured"**
- The app will stub evaluation; set `OPENAI_API_KEY` in backend `.env` to enable real AI evaluation

**CORS errors**
- Frontend Vite proxy should handle routing; check that backend is running on `http://localhost:3001`

## Future Enhancements

- [ ] Direct Magento Marketplace API integration
- [ ] Scheduled recurring scans
- [ ] Batch processing with job queues
- [ ] Admin dashboard with evaluation history
- [ ] Native feature mapping documentation
- [ ] Diff view comparing installed vs recommended versions
- [ ] PDF report generation
- [ ] Email notifications on completion

## License

MIT

## Support

For issues or questions, check the logs:
- Backend: `npm run dev` (shows parsing, lookup, AI prompts)
- Frontend: Browser console (F12 → Console)
# swat-ee
