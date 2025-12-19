import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

async function run() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()

  await page.goto('http://localhost:5173')

  // Wait for the file input to be present and set file
  const input = await page.$('input[type=file]')
  if (!input) throw new Error('File input not found')

  const sample = '/tmp/sample/sample_extensions.xlsx'
  if (!fs.existsSync(sample)) throw new Error(`Sample not found: ${sample}`)

  // Set file
  await input.setInputFiles(sample)

  // Click Start Evaluation button
  await page.click('button:has-text("Start Evaluation")')

  // Wait for processing state and then completed
  await page.waitForSelector('text=Processing', { timeout: 5000 })
  // Poll until completion indicator appears
  await page.waitForSelector('text=Evaluation Complete!', { timeout: 120000 })

  // Click Download Report
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("Download Report")'),
  ])

  const outPath = '/tmp/ui_playwright_download.xlsx'
  await download.saveAs(outPath)

  const stats = fs.statSync(outPath)
  console.log('Downloaded via Playwright:', outPath, stats.size)

  await browser.close()
}

run().catch((err) => {
  console.error('Playwright test failed:', err)
  process.exit(1)
})
