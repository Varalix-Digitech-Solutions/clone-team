// Tests for visual-diff.mjs — numeric visual-fidelity metrics.
// Run: node --test  (from skills/clone-team/scripts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const VDIFF = path.join(here, '..', 'visual-diff.mjs')

function run(args) {
  return execFileSync('node', [VDIFF, ...args], { encoding: 'utf8' })
}
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-vdiff-'))
}
// Writes a w×h PNG. `paint(x,y) => [r,g,b,a]` decides each pixel; defaults to white.
function writePng(file, w, h, paint) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2
      const [r, g, b, a] = paint ? paint(x, y) : [255, 255, 255, 255]
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png))
  return file
}

test('identical images → diffPixelRatio 0 and ssim ~1', () => {
  const d = tmp()
  const a = writePng(path.join(d, 'a.png'), 16, 16)
  const b = writePng(path.join(d, 'b.png'), 16, 16)
  const out = JSON.parse(run(['--original', a, '--clone', b]))
  assert.equal(out.width, 16)
  assert.equal(out.height, 16)
  assert.equal(out.diffPixels, 0)
  assert.equal(out.diffPixelRatio, 0)
  assert.ok(out.ssim >= 0.99, `ssim should be ~1, got ${out.ssim}`)
})

test('different images → diffPixelRatio > 0 and ssim < 1', () => {
  const d = tmp()
  const a = writePng(path.join(d, 'a.png'), 16, 16) // all white
  // half black
  const b = writePng(path.join(d, 'b.png'), 16, 16, (x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
  const out = JSON.parse(run(['--original', a, '--clone', b]))
  assert.ok(out.diffPixels > 0, 'some pixels differ')
  assert.ok(out.diffPixelRatio > 0 && out.diffPixelRatio <= 1, `ratio in (0,1], got ${out.diffPixelRatio}`)
  assert.ok(out.ssim < 1, `ssim should drop below 1, got ${out.ssim}`)
})

test('mismatched dimensions → metrics null, exit 0', () => {
  const d = tmp()
  const a = writePng(path.join(d, 'a.png'), 16, 16)
  const b = writePng(path.join(d, 'b.png'), 8, 8)
  const out = JSON.parse(run(['--original', a, '--clone', b]))
  assert.equal(out.diffPixelRatio, null)
  assert.equal(out.ssim, null)
  assert.ok(out.note && /dimension/i.test(out.note), 'explains the size mismatch')
})

test('writes a diff PNG when --diff-out is given', () => {
  const d = tmp()
  const a = writePng(path.join(d, 'a.png'), 16, 16)
  const b = writePng(path.join(d, 'b.png'), 16, 16, (x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
  const diffOut = path.join(d, 'diff.png')
  run(['--original', a, '--clone', b, '--diff-out', diffOut])
  assert.ok(fs.existsSync(diffOut), 'diff png written')
  assert.ok(fs.statSync(diffOut).size > 0, 'diff png non-empty')
})
