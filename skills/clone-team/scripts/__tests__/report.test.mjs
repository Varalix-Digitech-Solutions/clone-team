// Tests for report.mjs — the results-analysis source of truth.
// Run: node --test  (from skills/clone-team/scripts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPORT = path.join(here, '..', 'report.mjs')

function run(args, opts = {}) {
  return execFileSync('node', [REPORT, ...args], { encoding: 'utf8', ...opts })
}
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-report-'))
}
function readReport(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.clone-team', 'report.json'), 'utf8'))
}

test('init creates a report skeleton', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir, '--run-id', 'wf_test', '--goal', 'Clone X', '--target', 'https://x.test', '--stack', 'Next.js'])
  const r = readReport(dir)
  assert.equal(r.version, 1)
  assert.equal(r.runId, 'wf_test')
  assert.equal(r.goal, 'Clone X')
  assert.deepEqual(r.targetUrl, ['https://x.test'])
  assert.equal(r.finalVerdict, 'not-run')
  assert.ok(r.startedAt, 'startedAt set')
  assert.equal(r.completedAt, null)
  assert.deepEqual(r.sections, [])
})

test('append-round records per-round history in order with issue counts + metrics', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir, '--run-id', 'wf_test'])

  const issuesNG = JSON.stringify([
    { severity: 'blocker', area: 'layout', description: 'hero missing', expected: 'present', actual: 'absent' },
    { severity: 'major', area: 'color', description: 'wrong bg', expected: '#000', actual: '#111' },
    { severity: 'minor', area: 'text', description: 'kerning', expected: 'tight', actual: 'loose' },
  ])
  const metricsNG = JSON.stringify({ '1440': { diffPixelRatio: 0.031, ssim: 0.94 }, '768': { diffPixelRatio: 0.02, ssim: 0.95 }, '390': { diffPixelRatio: 0.05, ssim: 0.9 } })
  run(['append-round', '--dir', dir, '--section', 'Hero', '--round', '1', '--verdict', 'NG', '--issues-json', issuesNG, '--metrics-json', metricsNG])

  const metricsOK = JSON.stringify({ '1440': { diffPixelRatio: 0.0, ssim: 1.0 }, '768': { diffPixelRatio: 0.0, ssim: 1.0 }, '390': { diffPixelRatio: 0.001, ssim: 0.999 } })
  run(['append-round', '--dir', dir, '--section', 'Hero', '--round', '2', '--verdict', 'OK', '--issues-json', '[]', '--metrics-json', metricsOK])

  const r = readReport(dir)
  assert.equal(r.sections.length, 1)
  const sec = r.sections[0]
  assert.equal(sec.name, 'Hero')
  assert.equal(sec.rounds.length, 2)
  assert.equal(sec.rounds[0].round, 1)
  assert.equal(sec.rounds[0].verdict, 'NG')
  assert.equal(sec.rounds[1].round, 2)
  assert.equal(sec.rounds[1].verdict, 'OK')
  // issue counts by severity
  assert.deepEqual(sec.rounds[0].issueCounts, { blocker: 1, major: 1, minor: 1 })
  assert.deepEqual(sec.rounds[1].issueCounts, { blocker: 0, major: 0, minor: 0 })
  // metrics carried through
  assert.equal(sec.rounds[0].metrics['1440'].ssim, 0.94)
  assert.ok(sec.rounds[0].at, 'round timestamp set')
  // section resolves to pass once latest verdict is OK
  assert.equal(sec.status, 'pass')
})

test('append-round upserts the same section (no duplicates)', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir])
  run(['append-round', '--dir', dir, '--section', 'Nav', '--round', '1', '--verdict', 'NG', '--issues-json', '[]'])
  run(['append-round', '--dir', dir, '--section', 'Nav', '--round', '2', '--verdict', 'OK', '--issues-json', '[]'])
  const r = readReport(dir)
  assert.equal(r.sections.length, 1)
  assert.equal(r.sections[0].rounds.length, 2)
})

test('finalize sets finalVerdict, completedAt and summary', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir])
  run(['append-round', '--dir', dir, '--section', 'Hero', '--round', '1', '--verdict', 'OK', '--issues-json', '[]'])
  const summary = JSON.stringify({ sections: 1, passed: 1, flagged: [], backendCoverage: 'substantial' })
  run(['finalize', '--dir', dir, '--final-verdict', 'OK', '--summary-json', summary])
  const r = readReport(dir)
  assert.equal(r.finalVerdict, 'OK')
  assert.ok(r.completedAt, 'completedAt set')
  assert.equal(r.summary.passed, 1)
  assert.equal(r.summary.backendCoverage, 'substantial')
})

test('json command prints the report as valid JSON', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir, '--run-id', 'wf_json'])
  const out = run(['json', '--dir', dir])
  const parsed = JSON.parse(out)
  assert.equal(parsed.runId, 'wf_json')
})

test('render writes a self-contained HTML report with section + verdict', () => {
  const dir = tmpDir()
  run(['init', '--dir', dir, '--run-id', 'wf_html', '--goal', 'Clone Acme'])
  run(['append-round', '--dir', dir, '--section', 'Hero', '--round', '1', '--verdict', 'OK', '--issues-json', '[]'])
  run(['finalize', '--dir', dir, '--final-verdict', 'OK', '--summary-json', '{"sections":1,"passed":1,"flagged":[]}'])
  run(['render', '--dir', dir])
  const htmlPath = path.join(dir, '.clone-team', 'report.html')
  assert.ok(fs.existsSync(htmlPath), 'report.html exists')
  const html = fs.readFileSync(htmlPath, 'utf8')
  assert.ok(html.length > 500, 'html is non-trivial')
  assert.ok(html.includes('<!doctype html') || html.includes('<!DOCTYPE html'), 'is an html doc')
  assert.ok(html.includes('Hero'), 'mentions the section')
  assert.ok(html.includes('OK'), 'mentions the verdict')
})

test('append-round before init fails loudly (exit non-zero)', () => {
  const dir = tmpDir()
  assert.throws(() => run(['append-round', '--dir', dir, '--section', 'X', '--round', '1', '--verdict', 'OK', '--issues-json', '[]'], { stdio: 'pipe' }))
})
