const xlsx = require('xlsx');
const fs = require('fs');
const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node utils/inspect_results.js <jobId>');
  process.exit(2);
}
const p = `/tmp/results/${jobId}_evaluated.xlsx`;
if (!fs.existsSync(p)) {
  console.log('no results file yet at', p);
  process.exit(0);
}
const wb = xlsx.readFile(p);
const s = wb.Sheets['evaluation_results'] || wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(s);
console.log(JSON.stringify(rows.slice(0,6), null, 2));
