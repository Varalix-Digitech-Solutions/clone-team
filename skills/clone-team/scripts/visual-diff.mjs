#!/usr/bin/env node
// visual-diff.mjs — numeric visual-fidelity metrics for clone-team.
// Turns the Tester's screenshot comparison into objective numbers (pixel-diff
// ratio + SSIM) so each round carries a measurable score, not only a verdict.
// Pure-JS deps (pixelmatch + pngjs + ssim.js); no native/Python toolchain.
//
// Usage:
//   node visual-diff.mjs --original <a.png> --clone <b.png> [--diff-out <diff.png>] [--threshold 0.1]
//
// Prints one JSON line:
//   { "width":N, "height":N, "diffPixels":N, "diffPixelRatio":0.0123, "ssim":0.964 }
// On a size mismatch (common when the original and clone viewports differ),
// it does NOT crash the gate — it returns null metrics with a note and exits 0.

import fs from 'node:fs'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { ssim } from 'ssim.js'

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

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

const args = parseArgs(process.argv.slice(2))
const originalPath = args.original
const clonePath = args.clone
const diffOut = args['diff-out'] || null
const threshold = args.threshold !== undefined ? Number(args.threshold) : 0.1

if (!originalPath || !clonePath) {
  out({ error: 'usage', note: 'required: --original <png> --clone <png>', diffPixels: null, diffPixelRatio: null, ssim: null })
  process.exit(2)
}

let imgA, imgB
try {
  imgA = PNG.sync.read(fs.readFileSync(originalPath))
} catch (e) {
  out({ error: 'read-original', note: String((e && e.message) || e), diffPixels: null, diffPixelRatio: null, ssim: null })
  process.exit(2)
}
try {
  imgB = PNG.sync.read(fs.readFileSync(clonePath))
} catch (e) {
  out({ error: 'read-clone', note: String((e && e.message) || e), diffPixels: null, diffPixelRatio: null, ssim: null })
  process.exit(2)
}

// Size mismatch: report it, don't fail the run. A different-sized clone is a
// real (often large) fidelity problem, but it is the Tester's verdict that
// gates — these metrics only annotate it. Returning null keeps the gate alive.
if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
  out({
    width: imgA.width, height: imgA.height,
    cloneWidth: imgB.width, cloneHeight: imgB.height,
    diffPixels: null, diffPixelRatio: null, ssim: null,
    note: `dimension mismatch: original ${imgA.width}x${imgA.height} vs clone ${imgB.width}x${imgB.height}`,
  })
  process.exit(0)
}

const { width, height } = imgA
const total = width * height
const diff = diffOut ? new PNG({ width, height }) : null

const diffPixels = pixelmatch(imgA.data, imgB.data, diff ? diff.data : null, width, height, { threshold })
const diffPixelRatio = total > 0 ? Number((diffPixels / total).toFixed(6)) : 0

let ssimScore = null
try {
  const r = ssim({ data: imgA.data, width, height }, { data: imgB.data, width, height })
  ssimScore = Number(r.mssim.toFixed(4))
} catch (e) {
  ssimScore = null
}

if (diff) {
  try { fs.writeFileSync(diffOut, PNG.sync.write(diff)) } catch { /* non-fatal */ }
}

out({ width, height, diffPixels, diffPixelRatio, ssim: ssimScore })
