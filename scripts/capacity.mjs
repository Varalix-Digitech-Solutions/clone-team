#!/usr/bin/env node
// capacity.mjs — right-size a clone-team run to the HOST so nothing gets
// OOM-killed. Outputs a SAFE concurrent-browser budget and the derived waveSize.
//
// THE REAL CONSTRAINT (learned the hard way):
//  1. Each agent-browser session is NOT one process — Chromium forks ~50
//     processes (renderers/GPU/utility). One session driving a heavy animated
//     page measured **~4.2 GB RSS** on this project. Budget PER BROWSER SESSION,
//     not per "agent".
//  2. The thing that kills you is usually **systemd-oomd**, which culls a whole
//     cgroup on sustained memory *pressure* (PSI) — by default at 50% for 20s —
//     BEFORE RAM is exhausted. So "free RAM" overstates how much you can use;
//     leave generous headroom so pressure never sustains past the oomd limit.
//  3. Concurrency is the TOTAL number of live browser sessions at once =
//     waveSize (sections building in parallel) + (backend track, if concurrent)
//     + (any sub-builders that open their own browser). The probe sizes the
//     TOTAL; the orchestration must keep backend serial and sub-builders
//     browser-less when the budget is tight (see runConfig.serialBackend).
//
// Runs in normal Node (the Manager calls it), NOT in the Workflow sandbox.
//
// Usage:
//   node scripts/capacity.mjs            # full JSON report
//   node scripts/capacity.mjs --wave     # just the recommended waveSize (integer)
//   node scripts/capacity.mjs --browsers # just the max concurrent browser sessions
//
// Tunables (env overrides):
//   CT_PER_BROWSER_MB  RAM per concurrent agent-browser session (default 4400; measured ~4.2GB)
//   CT_RESERVE_MB      held back for Claude CLI (~2GB) + dev server/Vite + OS + pressure headroom (default 4096)
//   CT_MAX_WAVE        hard ceiling on concurrency (default 8)
//   CT_PRESSURE_BUDGET fraction of TOTAL ram the run may occupy before oomd risk (default 0.55)

import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'

function availableMB() {
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const m = mi.match(/MemAvailable:\s+(\d+)\s+kB/)
    if (m) return Math.round(parseInt(m[1], 10) / 1024)
  } catch { /* not Linux — fall back */ }
  return Math.round(os.freemem() / 1024 / 1024)
}

// systemd-oomd: detect it and read the user-slice memory-pressure kill limit.
// When present, it kills on PRESSURE (not exhaustion), so we must stay well below
// raw capacity. Returns { active, limitPct } or null.
function oomdInfo() {
  try {
    const active = execSync('systemctl is-active systemd-oomd 2>/dev/null', { encoding: 'utf8' }).trim() === 'active'
    if (!active) return { active: false, limitPct: null }
    let limitPct = 50 // systemd default DefaultMemoryPressureLimitPercent
    try {
      const uid = process.getuid ? process.getuid() : 1000
      const out = execSync(`systemctl show user@${uid}.service -p ManagedOOMMemoryPressureLimit 2>/dev/null`, { encoding: 'utf8' })
      const m = out.match(/=(\d+)/)
      // systemd encodes the percentage as a fraction of 2^32.
      if (m && Number(m[1]) > 0) limitPct = Math.round(Number(m[1]) / 4294967296 * 100)
    } catch { /* keep default */ }
    return { active: true, limitPct }
  } catch { return null }
}

function pressureNow() {
  try {
    const p = fs.readFileSync('/proc/pressure/memory', 'utf8')
    const some = p.match(/some .*avg10=([\d.]+)/)
    return some ? Number(some[1]) : null
  } catch { return null }
}

const PER_BROWSER_MB = Number(process.env.CT_PER_BROWSER_MB || 4400) // measured ~4.2GB/session (Chromium forks ~50 procs)
const RESERVE_MB = Number(process.env.CT_RESERVE_MB || 4096)        // Claude CLI (~2GB) + dev server/Vite + OS + pressure headroom
const HARD_MAX = Number(process.env.CT_MAX_WAVE || 8)
const PRESSURE_BUDGET = Number(process.env.CT_PRESSURE_BUDGET || 0.55) // run may occupy up to this fraction of TOTAL ram before oomd risk

const totalMB = Math.round(os.totalmem() / 1024 / 1024)
const availMB = availableMB()
const cores = os.cpus().length
const load1 = Number((os.loadavg()[0] || 0).toFixed(2))
const oomd = oomdInfo()
const psi = pressureNow()

// Two ceilings on concurrent browser sessions:
//  (a) RAM-fit: how many per-browser budgets fit in available headroom above the reserve.
const byRam = Math.floor((availMB - RESERVE_MB) / PER_BROWSER_MB)
//  (b) Pressure-fit (when oomd is active): keep TOTAL run memory under a safe
//      fraction of TOTAL ram so sustained pressure never reaches the oomd limit.
//      Tighten the budget proportionally if the kill limit is below the default 50%.
const pressureFrac = oomd && oomd.active
  ? Math.min(PRESSURE_BUDGET, (oomd.limitPct || 50) / 100 - 0.05)
  : 1
const byPressure = oomd && oomd.active
  ? Math.floor((totalMB * pressureFrac - RESERVE_MB) / PER_BROWSER_MB)
  : Infinity

const byCpu = Math.max(1, cores - 2)
const loadPenalty = load1 > cores ? 1 : 0

let maxBrowsers = Math.min(byRam, byPressure, byCpu, HARD_MAX) - loadPenalty
maxBrowsers = Math.max(1, maxBrowsers)

// The section wave must leave room for the backend browser if it runs
// concurrently. When the budget is 1, the backend MUST be serial (run after the
// section grind) — flag that loudly.
const serialBackendRequired = maxBrowsers <= 1
const waveSize = serialBackendRequired ? 1 : (maxBrowsers - 1) // reserve 1 slot for the concurrent backend track
const recommendedWaveSize = Math.max(1, waveSize)

const bound = maxBrowsers === byPressure ? 'pressure(oomd)'
  : maxBrowsers === byRam ? 'ram'
  : maxBrowsers === byCpu ? 'cpu'
  : 'ceiling'

const report = {
  totalMB, availableMB: availMB, totalGB: +(totalMB / 1024).toFixed(1), availableGB: +(availMB / 1024).toFixed(1),
  cores, load1,
  oomd: oomd && oomd.active ? { active: true, pressureKillLimitPct: oomd.limitPct } : { active: false },
  memPressureAvg10: psi,
  perBrowserMB: PER_BROWSER_MB, reserveMB: RESERVE_MB, hardMax: HARD_MAX, pressureBudgetFrac: pressureFrac,
  byRam, byPressure: byPressure === Infinity ? null : byPressure, byCpu, loadPenalty,
  maxConcurrentBrowsers: maxBrowsers,
  recommendedWaveSize,
  serialBackendRequired,
  noSubBuilderBrowsers: maxBrowsers <= 2,
  boundBy: bound,
  rationale: `${oomd && oomd.active ? `systemd-oomd active (kills user slice at ~${oomd.limitPct}% pressure) → budget ${(pressureFrac * 100).toFixed(0)}% of ${(totalMB / 1024).toFixed(1)}GB. ` : ''}~${PER_BROWSER_MB}MB per browser session (Chromium ≈50 procs), reserve ${(RESERVE_MB / 1024).toFixed(1)}GB → max ${maxBrowsers} concurrent browser(s) [${bound}-bound]. waveSize=${recommendedWaveSize}${serialBackendRequired ? ' + backend MUST run serial (after sections)' : ''}${maxBrowsers <= 2 ? ' + sub-builders must NOT open their own browser (share the section\'s session)' : ''}.`,
}

if (process.argv.includes('--wave')) console.log(recommendedWaveSize)
else if (process.argv.includes('--browsers')) console.log(maxBrowsers)
else console.log(JSON.stringify(report, null, 2))
