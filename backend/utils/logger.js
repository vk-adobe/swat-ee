import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.resolve(__dirname, '../logs')
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase()

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

function write(level, message, meta) {
  if ((LEVELS[level] ?? 0) < currentLevel) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  }

  const line = JSON.stringify(entry)

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }

  try {
    ensureLogDir()
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {
    // non-fatal — stdout already written
  }
}

const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
}

export default logger
