import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseManifest } from '@dsh-std/manifest'
import { PACKAGE_ROOT } from '../lib/binary.js'
import { PUBLIC_TOOL_NAMES } from '../lib/index.js'

const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const archive = path.join(PACKAGE_ROOT, `${pkg.name}-${pkg.version}.tgz`)
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
for (const entry of listing) {
  assert.ok(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unexpected archive path: ${entry}`)
  assert.ok(!/(^|\/)(target|node_modules|test|\.git|\.tmp[^/]*)(\/|$)/.test(entry), `Development file in archive: ${entry}`)
}
const temporary = fs.mkdtempSync(path.join(PACKAGE_ROOT, '.tmp-package-'))
assert.equal(path.dirname(temporary), PACKAGE_ROOT)
try {
  execFileSync('tar', ['-xzf', archive, '-C', temporary], { windowsHide: true })
  const root = path.join(temporary, 'package')
  const manifest = parseManifest(fs.readFileSync(path.join(root, 'dsh-plugin.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
  assert.equal((await import(pathToFileURL(path.join(root, 'lib/index.js')).href)).name, pkg.name)
  const status = JSON.parse(execFileSync(process.execPath, [path.join(root, 'bin/dsh-fasttool.mjs'), 'status'], { encoding: 'utf8', windowsHide: true, timeout: 40_000 }))
  assert.deepEqual(status.tools, [...PUBLIC_TOOL_NAMES].sort())
  const module = await import(pathToFileURL(path.join(root, 'lib/shellcheck.js')).href)
  const runner = new module.ShellcheckRunner()
  try {
    const result = await runner.check({ script: '#!/bin/bash\necho $name\n' })
    assert.ok(result.structuredContent.diagnostics.some(item => item.code === 'SC2086'))
  } finally { await runner.stop() }
  console.log(`Archive verified: ${path.basename(archive)}, ${listing.length} files, standalone runtime and plugin entry load correctly.`)
} finally {
  // This generated extraction is recoverable from the retained archive.
  fs.rmSync(temporary, { recursive: true, force: true })
}
