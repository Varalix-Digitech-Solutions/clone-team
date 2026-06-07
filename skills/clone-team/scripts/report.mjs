#!/usr/bin/env node
// report.mjs — durable results-analysis record for clone-team runs.
// This is the single source of truth for "how did this run turn out": it
// captures every Tester verdict (per section, per round) with issue counts and
// numeric visual metrics, then renders a self-contained HTML report from it.
//
// It mirrors state.mjs on purpose (same argv parsing, same --dir convention,
// same OS-clock-here rule) so the two read like one toolkit. state.mjs tracks
// LIFECYCLE (what phase / which sections are done); report.mjs tracks OUTCOME
// (what the results were). The Workflow runtime cannot write files, so the
// Tester (per round) and the Manager (on completion) call this CLI to persist.
//
// Usage:
//   node report.mjs init        --dir <projectDir> [--run-id wf_x] [--goal ..] [--target ..] [--stack ..]
//   node report.mjs append-round --dir <projectDir> --section <name> --round <N> --verdict OK|NG \
//                                --issues-json '<json-array>' [--metrics-json '<json>'] [--section-status pass|flagged|building]
//   node report.mjs finalize    --dir <projectDir> --final-verdict OK|NG --summary-json '<json>'
//   node report.mjs json        --dir <projectDir>
//   node report.mjs render      --dir <projectDir>           # writes .clone-team/report.html

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) a[key] = true
      else { a[key] = next; i++ }
    } else a._.push(t)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
const dir = args.dir || process.cwd()
const stateDir = path.join(dir, '.clone-team')
const reportFile = path.join(stateDir, 'report.json')
const htmlFile = path.join(stateDir, 'report.html')

function nowIso() { return new Date().toISOString() }

function readReport() {
  if (!fs.existsSync(reportFile)) {
    console.error(`No report at ${reportFile}. Run "report.mjs init" first.`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(reportFile, 'utf8'))
}

function writeReport(r) {
  r.updatedAt = nowIso()
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(reportFile, JSON.stringify(r, null, 2) + '\n')
  return r
}

function defaultReport() {
  return {
    version: 1,
    runId: args['run-id'] || null,
    goal: args.goal || '',
    targetUrl: args.target ? [args.target] : [],
    stack: args.stack || '',
    startedAt: nowIso(),
    completedAt: null,
    finalVerdict: 'not-run',
    summary: { sections: 0, passed: 0, flagged: [], backendCoverage: 'unknown' },
    sections: [],
    backend: { coverage: null, gaps: [], docPath: null },
    artifacts: { html: '.clone-team/report.html' },
    updatedAt: nowIso(),
  }
}

function countIssues(issues) {
  const c = { blocker: 0, major: 0, minor: 0 }
  for (const it of issues || []) {
    if (it && c[it.severity] !== undefined) c[it.severity]++
  }
  return c
}

// finalScore = mean SSIM across whatever viewports the latest round measured.
// null when no numeric metrics were captured (e.g. metrics were skipped).
function scoreFromMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null
  const ssims = Object.values(metrics)
    .map(v => (v && typeof v.ssim === 'number' ? v.ssim : null))
    .filter(v => v !== null)
  if (!ssims.length) return null
  return Number((ssims.reduce((a, b) => a + b, 0) / ssims.length).toFixed(4))
}

function parseJsonArg(name, fallback) {
  const raw = args[name]
  if (raw === undefined || raw === true) return fallback
  try { return JSON.parse(raw) } catch (e) { console.error(`Invalid --${name}: ${e.message}`); process.exit(2) }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

switch (cmd) {
  case 'init': {
    if (fs.existsSync(reportFile)) { console.log(`Report already exists at ${reportFile}`); break }
    const r = writeReport(defaultReport())
    console.log(`Initialized ${reportFile}`)
    console.log(JSON.stringify(r, null, 2))
    break
  }

  case 'append-round': {
    const r = readReport()
    const name = args.section
    if (!name) { console.error('--section required'); process.exit(2) }
    const verdict = args.verdict === 'OK' ? 'OK' : 'NG'
    const round = args.round !== undefined ? Number(args.round) : (1)
    const issues = parseJsonArg('issues-json', [])
    const metrics = args['metrics-json'] !== undefined ? parseJsonArg('metrics-json', null) : null

    let sec = r.sections.find(s => s.name === name)
    if (!sec) { sec = { name, status: 'building', rounds: [], finalScore: null }; r.sections.push(sec) }

    const roundRec = { round, verdict, at: nowIso(), issueCounts: countIssues(issues), issues }
    if (metrics) roundRec.metrics = metrics
    sec.rounds.push(roundRec)

    // Derive section status + finalScore from the latest round. An explicit
    // --section-status (e.g. 'flagged' when the Manager hits the round cap)
    // always wins over the derived value.
    sec.status = args['section-status'] || (verdict === 'OK' ? 'pass' : 'flagged')
    const sc = scoreFromMetrics(metrics)
    if (sc !== null) sec.finalScore = sc

    writeReport(r)
    console.log(`round ${round} (${verdict}) recorded for "${name}"`)
    break
  }

  case 'finalize': {
    const r = readReport()
    if (args['final-verdict']) r.finalVerdict = args['final-verdict'] === 'OK' ? 'OK' : (args['final-verdict'] === 'not-run' ? 'not-run' : 'NG')
    const summary = args['summary-json'] !== undefined ? parseJsonArg('summary-json', null) : null
    if (summary) r.summary = { ...r.summary, ...summary }
    if (args['backend-coverage']) r.backend.coverage = args['backend-coverage']
    r.completedAt = nowIso()
    writeReport(r)
    console.log(`finalized: ${r.finalVerdict} (${r.summary.passed}/${r.summary.sections} passed)`)
    break
  }

  case 'json': {
    console.log(JSON.stringify(readReport(), null, 2))
    break
  }

  case 'render': {
    const r = readReport()
    const html = renderHtml(r)
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(htmlFile, html)
    console.log(`rendered ${htmlFile}`)
    break
  }

  default:
    console.error('Unknown command. See header of report.mjs for usage.')
    process.exit(2)
}

// --- HTML renderer ----------------------------------------------------------
// Self-contained: no external CSS/JS. Source of truth is report.json; this is
// the disposable human "receipt" (JSON-then-render convention).
function renderHtml(r) {
  const vClass = v => v === 'OK' ? 'ok' : v === 'NG' ? 'ng' : 'na'
  const viewports = ['1440', '768', '390']

  const sectionRows = (r.sections || []).map(sec => {
    const trend = sec.rounds.map(rd => `R${rd.round} <span class="${vClass(rd.verdict)}">${esc(rd.verdict)}</span>`).join(' → ')
    const last = sec.rounds[sec.rounds.length - 1] || {}
    const m = last.metrics || {}
    const metricCells = viewports.map(vp => {
      const cell = m[vp]
      if (!cell || cell.ssim == null) return `<td class="num mut">—</td>`
      const pct = cell.diffPixelRatio == null ? '—' : (cell.diffPixelRatio * 100).toFixed(2) + '%'
      return `<td class="num">ssim ${cell.ssim}<br><span class="mut">${pct} diff</span></td>`
    }).join('')
    const totals = sec.rounds.reduce((acc, rd) => {
      acc.blocker += rd.issueCounts.blocker; acc.major += rd.issueCounts.major; acc.minor += rd.issueCounts.minor; return acc
    }, { blocker: 0, major: 0, minor: 0 })
    return `<tr>
      <td><b>${esc(sec.name)}</b></td>
      <td><span class="badge ${sec.status === 'pass' ? 'ok' : 'ng'}">${esc(sec.status)}</span></td>
      <td class="num">${sec.rounds.length}</td>
      <td>${trend || '—'}</td>
      ${metricCells}
      <td class="num">${sec.finalScore == null ? '—' : sec.finalScore}</td>
      <td class="num"><span class="bl">${totals.blocker}</span>/<span class="mj">${totals.major}</span>/<span class="mn">${totals.minor}</span></td>
    </tr>`
  }).join('')

  // Outstanding issues = issues from each section's LAST round (the state it ended in).
  const issueBlocks = (r.sections || []).map(sec => {
    const last = sec.rounds[sec.rounds.length - 1]
    if (!last || !last.issues || !last.issues.length) return ''
    const items = last.issues.map(i => `<li><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span> <b>${esc(i.area)}</b> — ${esc(i.description)}<br><span class="mut">expected: ${esc(i.expected)} · actual: ${esc(i.actual)}${i.repro ? ' · repro: ' + esc(i.repro) : ''}</span></li>`).join('')
    return `<h3>${esc(sec.name)} — open issues (round ${last.round}, ${esc(last.verdict)})</h3><ul class="issues">${items}</ul>`
  }).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>clone-team report — ${esc(r.goal || r.runId || 'run')}</title>
<style>
  :root{--bg:#0b0e14;--panel:#121722;--ink:#e6edf3;--mut:#9aa7b4;--line:#1e2733;--accent:#7c93ff;--good:#34d399;--bad:#f87171;--warn:#fbbf24;--mono:ui-monospace,"Cascadia Code",Consolas,monospace}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:40px 22px 80px}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
  h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:9px;margin:36px 0 14px}
  h3{font-size:15px;margin:22px 0 6px}
  .meta{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0 4px}
  .pill{font:600 12px/1 var(--mono);padding:7px 10px;border-radius:999px;background:#1a2230;border:1px solid var(--line);color:var(--mut)}
  .pill b{color:var(--ink)}
  .verdict{display:inline-block;font:800 13px/1 var(--mono);padding:9px 14px;border-radius:10px;margin-top:14px}
  .verdict.ok{background:#0f1f18;color:var(--good);border:1px solid #244c3a}
  .verdict.ng{background:#1f1313;color:var(--bad);border:1px solid #4c2424}
  .verdict.na{background:#171b24;color:var(--mut);border:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;font-size:13.5px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#0f141d;color:var(--mut);font:600 11px/1.2 var(--mono);letter-spacing:.04em;text-transform:uppercase}
  tr:last-child td{border-bottom:none}
  .num{font:600 13px/1.3 var(--mono);text-align:right;white-space:nowrap}
  .mut{color:var(--mut)} .ok{color:var(--good)} .ng{color:var(--bad)} .na{color:var(--mut)}
  .badge{font:700 11px/1 var(--mono);padding:4px 8px;border-radius:6px}
  .badge.ok{background:#0f1f18;color:var(--good)} .badge.ng{background:#1f1313;color:var(--bad)}
  .bl{color:var(--bad)} .mj{color:var(--warn)} .mn{color:var(--mut)}
  ul.issues{list-style:none;padding:0;margin:8px 0}
  ul.issues li{border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin:7px 0;background:var(--panel)}
  .sev{font:700 10px/1 var(--mono);padding:3px 6px;border-radius:5px;text-transform:uppercase}
  .sev.blocker{background:#1f1313;color:var(--bad)} .sev.major{background:#211a08;color:var(--warn)} .sev.minor{background:#171b24;color:var(--mut)}
  footer{margin-top:40px;color:var(--mut);font-size:12.5px;border-top:1px solid var(--line);padding-top:16px;font-family:var(--mono)}
</style></head>
<body><div class="wrap">
  <h1>🧬 clone-team — run report</h1>
  <div class="meta">
    ${r.runId ? `<span class="pill">run <b>${esc(r.runId)}</b></span>` : ''}
    ${r.targetUrl && r.targetUrl.length ? `<span class="pill">target <b>${esc(r.targetUrl.join(', '))}</b></span>` : ''}
    ${r.stack ? `<span class="pill">stack <b>${esc(r.stack)}</b></span>` : ''}
    <span class="pill">started <b>${esc(r.startedAt)}</b></span>
    <span class="pill">completed <b>${esc(r.completedAt || 'in progress')}</b></span>
  </div>
  ${r.goal ? `<p class="mut">${esc(r.goal)}</p>` : ''}
  <div class="verdict ${vClass(r.finalVerdict)}">FINAL: ${esc(r.finalVerdict)}</div>
  <span class="pill" style="margin-left:8px">passed <b>${r.summary.passed}/${r.summary.sections}</b></span>
  ${r.summary.flagged && r.summary.flagged.length ? `<span class="pill">flagged <b>${esc(r.summary.flagged.join(', '))}</b></span>` : ''}
  ${r.backend && r.backend.coverage ? `<span class="pill">backend <b>${esc(r.backend.coverage)}</b></span>` : ''}

  <h2>Scorecard</h2>
  <table>
    <tr><th>Section</th><th>Status</th><th>Rounds</th><th>Trend</th><th>1440</th><th>768</th><th>390</th><th>Score</th><th>Issues b/m/n</th></tr>
    ${sectionRows || '<tr><td colspan="9" class="mut">No sections recorded.</td></tr>'}
  </table>

  ${issueBlocks ? '<h2>Outstanding issues</h2>' + issueBlocks : ''}

  <footer>report.json is the source of truth · regenerate this file with <code>node report.mjs render --dir &lt;projectDir&gt;</code></footer>
</div></body></html>`
}
