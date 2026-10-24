import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PACKAGE_ROOT } from '../lib/binary.js'

const runtime = path.join(PACKAGE_ROOT, 'runtime')
const upstream = JSON.parse(fs.readFileSync(path.join(runtime, 'UPSTREAM.json'), 'utf8'))
const modified = new Set(['src/read_tool/pdf_engine.rs'])
for (const record of upstream.files) {
  const text = fs.readFileSync(path.join(runtime, record.path), 'utf8').replaceAll('\r\n', '\n')
  if (modified.has(record.path)) { assert.match(text, /Modified by dsh-fasttool/); continue }
  const digest = createHash('sha256').update(text).digest('hex')
  assert.equal(digest, record.sha256LF, `Unexpected changes in extracted source: ${record.path}`)
}
for (const forbidden of ['shell', 'edit', 'control', 'runtime', 'update', 'tui', 'cli']) {
  assert.equal(fs.existsSync(path.join(runtime, 'src', forbidden)), false, `Excluded module copied: ${forbidden}`)
}
console.log(`Source extraction verified against ${upstream.commit}: ${upstream.files.length} original files, one declared engine adaptation.`)
