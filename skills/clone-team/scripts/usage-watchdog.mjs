#!/usr/bin/env node
// usage-watchdog.mjs — zero-token poller for the account's 5-hour usage window.
// Polls the same endpoint Claude Code's /usage screen uses and, when utilization
// crosses a threshold, writes sentinel files that the running team's agents check
// between steps (see the wrap-up protocol in workflows/clone-build-loop.js and
// every agents/*.md persona):
//
//   .clone-team/WRAP_UP    soft stop (default >= 80%): finish the current atomic
//                          step, write a handoff report, return early.
//   .clone-team/HARD_STOP  hard stop (default >= 90%): stop immediately, flush
//                          the handoff as-is.
//
// The watchdog itself costs zero tokens — it is pure node, no model involved.
// The Manager launches `start` as a background process at the top of Phase 2.
//
// Usage:
//   node scripts/usage-watchdog.mjs start --dir <projectDir> [--interval 300] [--warm 80] [--hard 90]
//   node scripts/usage-watchdog.mjs check --dir <projectDir> [--warm 80] [--hard 90]   # one poll
//   node scripts/usage-watchdog.mjs resets-at --dir <projectDir>                        # print resets_at (for the cron wake)
//   node scripts/usage-watchdog.mjs clear --dir <projectDir>                            # remove sentinels
//
// Failure posture: a failed fetch is logged and IGNORED (never treated as 0%).
// When utilization drops back below the warm threshold (a new window), sentinels
// are removed so a resumed run is not immediately tripped. The endpoint is
// undocumented (it is what /usage calls) — if it ever changes shape, the watchdog
// degrades to logging errors and the run simply loses early warning, nothing else.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) { a[key] = true }
      else { a[key] = next; i++ }
    } else a._.push(t)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
const dir = args.dir || process.cwd()
const stateDir = path.join(dir, '.clone-team')
const warm = Number(args.warm) || 80
const hard = Number(args.hard) || 90
const intervalSec = Number(args.interval) || 300

const sentinel = (name) => path.join(stateDir, name)

function tokenFromBlob(blob) {
  const token = JSON.parse(blob)?.claudeAiOauth?.accessToken
  if (!token) throw new Error('no claudeAiOauth.accessToken in credentials blob')
  return token
}

function readToken() {
  // Credential source is OS-specific because each OS stores Claude Code's login
  // token in a different vault — there is no one path that works everywhere.
  // macOS: the LIVE token lives in the login Keychain ("Claude Code-credentials");
  // the on-disk ~/.claude/.credentials.json is frequently a STALE copy whose token
  // has expired while the Keychain stays current, so reading the file there yields
  // 401s. Read the Keychain first on macOS; the token is never written anywhere —
  // we just read from the right vault. Linux/Windows (and macOS as a fallback if
  // the Keychain entry is missing) use the on-disk file.
  if (process.platform === 'darwin') {
    try {
      const blob = execFileSync('security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8' })
      return tokenFromBlob(blob.trim())
    } catch { /* fall through to the on-disk file */ }
  }
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  return tokenFromBlob(fs.readFileSync(credFile, 'utf8'))
}

async function fetchUsage() {
  const res = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${readToken()}`, 'anthropic-beta': 'oauth-2025-04-20' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  const fiveHour = body?.five_hour
  if (typeof fiveHour?.utilization !== 'number') throw new Error('unexpected response shape (no five_hour.utilization)')
  return { utilization: fiveHour.utilization, resetsAt: fiveHour.resets_at || null }
}

function writeSentinel(name, level, usage) {
  const p = sentinel(name)
  if (fs.existsSync(p)) return false // keep the first trip's timestamp
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ level, utilization: usage.utilization, resetsAt: usage.resetsAt, writtenAt: new Date().toISOString() }, null, 2) + '\n')
  return true
}

function clearSentinels() {
  let removed = []
  for (const name of ['WRAP_UP', 'HARD_STOP']) {
    const p = sentinel(name)
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed.push(name) }
  }
  return removed
}

function readSentinel(name) {
  const p = sentinel(name)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

async function pollOnce() {
  let usage
  try {
    usage = await fetchUsage()
  } catch (e) {
    console.error(`[usage-watchdog] poll failed (${e.message}) — keeping current sentinels, will retry`)
    return null
  }
  const pct = usage.utilization
  if (pct >= hard) {
    if (writeSentinel('WRAP_UP', 'warm', usage)) console.log(`[usage-watchdog] ${pct}% >= warm ${warm}% — wrote WRAP_UP`)
    if (writeSentinel('HARD_STOP', 'hard', usage)) console.log(`[usage-watchdog] ${pct}% >= hard ${hard}% — wrote HARD_STOP`)
  } else if (pct >= warm) {
    if (writeSentinel('WRAP_UP', 'warm', usage)) console.log(`[usage-watchdog] ${pct}% >= warm ${warm}% — wrote WRAP_UP`)
  } else {
    const removed = clearSentinels()
    if (removed.length) console.log(`[usage-watchdog] ${pct}% < warm ${warm}% (window reset) — cleared ${removed.join(', ')}`)
  }
  console.log(`[usage-watchdog] five-hour window: ${pct}%${usage.resetsAt ? ` (resets ${usage.resetsAt})` : ''}`)
  return usage
}

switch (cmd) {
  case 'check': {
    const usage = await pollOnce()
    if (!usage) process.exit(1)
    console.log(JSON.stringify({ ...usage, warm, hard, wrapUp: fs.existsSync(sentinel('WRAP_UP')), hardStop: fs.existsSync(sentinel('HARD_STOP')) }))
    break
  }
  case 'resets-at': {
    // For the cron wake: print the resets_at timestamp the Manager schedules
    // against. Prefer a tripped sentinel's recorded value (the window that caused
    // the drain); fall back to a live poll if no sentinel is present.
    const fromSentinel = readSentinel('HARD_STOP') || readSentinel('WRAP_UP')
    if (fromSentinel?.resetsAt) { console.log(fromSentinel.resetsAt); break }
    try { const u = await fetchUsage(); console.log(u.resetsAt || '') }
    catch (e) { console.error(`[usage-watchdog] resets-at poll failed (${e.message})`); process.exit(1) }
    break
  }
  case 'start': {
    console.log(`[usage-watchdog] watching ${stateDir} — interval ${intervalSec}s, warm ${warm}%, hard ${hard}%`)
    for (;;) {
      await pollOnce()
      await new Promise(r => setTimeout(r, intervalSec * 1000))
    }
    break // unreachable; the Manager stops the background process
  }
  case 'clear': {
    const removed = clearSentinels()
    console.log(removed.length ? `cleared ${removed.join(', ')}` : '(no sentinels present)')
    break
  }
  default:
    console.error('Unknown command. See header of usage-watchdog.mjs for usage.')
    process.exit(2)
}
