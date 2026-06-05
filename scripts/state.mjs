#!/usr/bin/env node
// state.mjs — durable state for clone-team runs.
// The Manager uses these helpers instead of hand-editing .clone-team/state.json,
// so the file stays valid and every change is timestamped. Time is read here
// (from the OS), never inside the Workflow script where clocks are unavailable.
//
// Usage:
//   node scripts/state.mjs init      --dir <projectDir> [--goal ..] [--stack ..] [--target ..]
//   node scripts/state.mjs get       --dir <projectDir>
//   node scripts/state.mjs status    --dir <projectDir>
//   node scripts/state.mjs set       --dir <projectDir> --key phase --value build
//   node scripts/state.mjs set-phase --dir <projectDir> --phase build
//   node scripts/state.mjs set-run   --dir <projectDir> --run-id wf_xxx
//   node scripts/state.mjs add-section  --dir <projectDir> --json '{"name":"Hero",...}'
//   node scripts/state.mjs mark-section --dir <projectDir> --name Hero --status done [--rounds 2]
//   node scripts/state.mjs remaining --dir <projectDir>   # prints not-done sections as JSON

import fs from 'node:fs'
import path from 'node:path'

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
const stateFile = path.join(stateDir, 'state.json')

function nowIso() { return new Date().toISOString() }

function readState() {
  if (!fs.existsSync(stateFile)) {
    console.error(`No state file at ${stateFile}. Run "init" first.`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
}

function writeState(s) {
  s.updatedAt = nowIso()
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n')
  return s
}

function defaultState() {
  return {
    version: 1,
    goal: args.goal || '',
    targetUrl: args.target ? [args.target] : [],
    stack: args.stack || 'Next.js + Tailwind v4 + shadcn/ui',
    projectDir: dir,
    credsFilePath: null,
    loginQuirks: '',
    appInsights: '',
    runConfig: { modelTier: 'max-fidelity', autonomy: 'autonomous', maxRounds: 4, finalCap: 3, backendDepth: 'inferred' },
    paths: { research: 'docs/research', components: 'docs/research/components', designRefs: 'docs/design-references' },
    phase: 'setup',
    lastRunId: null,
    foundation: { done: false, buildPasses: false },
    sections: [],
    backend: { status: 'pending', docPath: 'docs/research/ARCHITECTURE.md' },
    flagged: [],
    updatedAt: nowIso(),
  }
}

function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}
    o = o[parts[i]]
  }
  o[parts[parts.length - 1]] = value
}

function coerce(v) {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !isNaN(Number(v))) return Number(v)
  return v
}

switch (cmd) {
  case 'init': {
    if (fs.existsSync(stateFile)) { console.log(`State already exists at ${stateFile}`); break }
    const s = writeState(defaultState())
    console.log(`Initialized ${stateFile}`)
    console.log(JSON.stringify(s, null, 2))
    break
  }
  case 'get': {
    console.log(JSON.stringify(readState(), null, 2))
    break
  }
  case 'status': {
    const s = readState()
    const by = (st) => s.sections.filter(x => x.status === st).map(x => x.name)
    console.log(`clone-team status — ${stateFile}`)
    console.log(`  goal:    ${s.goal || '(unset)'}`)
    console.log(`  target:  ${(Array.isArray(s.targetUrl) ? s.targetUrl.join(', ') : s.targetUrl) || '(unset)'}`)
    console.log(`  stack:   ${s.stack}`)
    console.log(`  phase:   ${s.phase}`)
    console.log(`  tier:    ${s.runConfig?.modelTier}  autonomy: ${s.runConfig?.autonomy}`)
    console.log(`  lastRun: ${s.lastRunId || '(none)'}`)
    console.log(`  foundation: ${s.foundation?.done ? 'done' : 'pending'}`)
    console.log(`  sections: ${s.sections.length} total`)
    console.log(`     done:     ${by('done').length}  ${by('done').join(', ')}`)
    console.log(`     building: ${by('building').length}  ${by('building').join(', ')}`)
    console.log(`     built:    ${by('built').length}  ${by('built').join(', ')}`)
    console.log(`     spec:     ${by('spec').length}  ${by('spec').join(', ')}`)
    console.log(`     pending:  ${by('pending').length}  ${by('pending').join(', ')}`)
    console.log(`     flagged:  ${by('flagged').length}  ${by('flagged').join(', ')}`)
    console.log(`  backend:  ${s.backend?.status} -> ${s.backend?.docPath}`)
    break
  }
  case 'set': {
    const s = readState()
    if (!args.key) { console.error('--key required'); process.exit(2) }
    setDeep(s, args.key, coerce(args.value))
    writeState(s)
    console.log(`set ${args.key} = ${args.value}`)
    break
  }
  case 'set-phase': {
    const s = readState(); s.phase = args.phase; writeState(s)
    console.log(`phase -> ${args.phase}`)
    break
  }
  case 'set-run': {
    const s = readState(); s.lastRunId = args['run-id']; writeState(s)
    console.log(`lastRunId -> ${args['run-id']}`)
    break
  }
  case 'add-section': {
    const s = readState()
    let sec
    try { sec = JSON.parse(args.json) } catch (e) { console.error('Invalid --json'); process.exit(2) }
    if (!sec.status) sec.status = 'pending'
    const i = s.sections.findIndex(x => x.name === sec.name)
    if (i >= 0) s.sections[i] = { ...s.sections[i], ...sec }
    else s.sections.push(sec)
    writeState(s)
    console.log(`section "${sec.name}" upserted (status: ${sec.status})`)
    break
  }
  case 'mark-section': {
    const s = readState()
    const sec = s.sections.find(x => x.name === args.name)
    if (!sec) { console.error(`No section named ${args.name}`); process.exit(2) }
    if (args.status) sec.status = args.status
    if (args.rounds !== undefined) sec.rounds = coerce(args.rounds)
    if (args['spec-path']) sec.specPath = args['spec-path']
    if (args['target-file']) sec.targetFile = args['target-file']
    if (args.status === 'flagged' && !s.flagged.includes(args.name)) s.flagged.push(args.name)
    if (args.status === 'done') s.flagged = s.flagged.filter(n => n !== args.name)
    writeState(s)
    console.log(`section "${args.name}" -> ${sec.status}`)
    break
  }
  case 'reconcile': {
    // Durable disk<->state sync. Run at resume so the loop never redoes finished
    // work and never silently trusts an unverified file. Encodes the resume rules
    // in CODE (not Manager discretion): fill specPath from disk (D2 — don't
    // re-extract); mark on-disk-but-unverified files 'built' (D3 — Tester
    // re-validates, not a blind rebuild); demote 'done'-without-file to 'pending';
    // rebase a stale projectDir to where this state.json actually lives (D4).
    const s = readState()
    const abs = path.resolve(dir)
    const compDir = s.paths?.components || 'docs/research/components'
    const changes = []
    if (s.projectDir && path.resolve(s.projectDir) !== abs) {
      changes.push(`projectDir: ${s.projectDir} -> ${abs} (rebased to actual location)`)
      s.projectDir = abs
    }
    for (const sec of s.sections) {
      const slug = (sec.name || '').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
      if (!sec.specPath) {
        const guess = path.join(compDir, slug + '.spec.md')
        if (fs.existsSync(path.join(dir, guess))) { sec.specPath = guess; changes.push(`${sec.name}: specPath <- ${guess}`) }
      }
      const fileExists = sec.targetFile && fs.existsSync(path.join(dir, sec.targetFile))
      if (sec.status === 'done' && !fileExists) {
        sec.status = 'pending'; changes.push(`${sec.name}: done -> pending (targetFile missing on disk)`)
      } else if (sec.status !== 'done' && fileExists && sec.status !== 'built') {
        const prev = sec.status; sec.status = 'built'
        changes.push(`${sec.name}: ${prev} -> built (file on disk, awaits Tester re-validation)`)
      }
    }
    writeState(s)
    console.log(`reconciled ${stateFile}`)
    if (changes.length) changes.forEach(c => console.log('  ' + c))
    else console.log('  (no changes — state already matches disk)')
    break
  }
  case 'remaining': {
    const s = readState()
    // Sections the Workflow still needs to do, reconciled with disk:
    // a section is "done" only if marked done AND its target file exists.
    const remaining = s.sections.filter(sec => {
      if (sec.status !== 'done') return true
      if (sec.targetFile && !fs.existsSync(path.join(dir, sec.targetFile))) return true
      return false
    })
    console.log(JSON.stringify(remaining, null, 2))
    break
  }
  default:
    console.error('Unknown command. See header of state.mjs for usage.')
    process.exit(2)
}
