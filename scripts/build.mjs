#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PACKAGE_ROOT, nativeDirectory, executableName } from '../lib/binary.js'

export async function build({ pdf = true, debug = false } = {}) {
  const args = ['build', '--locked', '--manifest-path', path.join(PACKAGE_ROOT, 'runtime', 'Cargo.toml')]
  if (!debug) args.push('--release')
  if (!pdf) args.push('--no-default-features')
  const cargo = process.env.DSH_FASTTOOL_CARGO ?? 'cargo'
  await new Promise((resolve, reject) => {
    const child = spawn(cargo, args, { cwd: PACKAGE_ROOT, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`cargo exited with ${code}`)))
  })
  const target = process.env.CARGO_TARGET_DIR ? path.resolve(PACKAGE_ROOT, process.env.CARGO_TARGET_DIR) : path.join(PACKAGE_ROOT, 'runtime', 'target')
  const source = path.join(target, debug ? 'debug' : 'release', executableName)
  const bytes = fs.readFileSync(source)
  fs.mkdirSync(nativeDirectory, { recursive: true })
  // Stage before rename so interrupted builds do not leave a partial executable.
  const output = path.join(nativeDirectory, executableName)
  fs.writeFileSync(`${output}.tmp`, bytes, { mode: 0o755 })
  fs.renameSync(`${output}.tmp`, output)
  fs.writeFileSync(path.join(nativeDirectory, 'receipt.json'), JSON.stringify({
    name: 'dsh-fasttool-runtime', version: '0.1.0', platform: process.platform, arch: process.arch,
    pdf, profile: debug ? 'debug' : 'release', sha256: createHash('sha256').update(bytes).digest('hex'),
  }, null, 2) + '\n')
  console.log(`Built ${output} (${pdf ? 'PDF enabled' : 'PDF disabled'})`)
  if (process.platform === 'win32' && process.arch === 'x64') {
    const { buildShellcheck } = await import('./build-shellcheck.mjs')
    await buildShellcheck()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2).filter(arg => !['--no-pdf', '--debug'].includes(arg))
  if (unknown.length) throw new Error(`Unknown build option: ${unknown.join(', ')}`)
  await build({ pdf: !process.argv.includes('--no-pdf'), debug: process.argv.includes('--debug') })
}
