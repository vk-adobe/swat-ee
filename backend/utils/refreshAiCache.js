import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cachePath = path.resolve(__dirname, '../data/ai-cache.json')

async function refreshCache() {
  const dir = path.dirname(cachePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify({ research: {}, evaluation: {} }, null, 2), 'utf8')
  console.log(`AI cache refreshed: ${cachePath}`)
}

refreshCache().catch((err) => {
  console.error('Failed to refresh AI cache:', err.message)
  process.exit(1)
})
