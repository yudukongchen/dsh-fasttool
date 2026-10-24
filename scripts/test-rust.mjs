import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PACKAGE_ROOT } from '../lib/binary.js'

// Keep Windows tempfile ACLs inside the workspace instead of depending on the
// host's system TEMP ACL. This applies only to this test process and its children.
const temporary = fs.mkdtempSync(path.join(PACKAGE_ROOT, '.tmp-rust-'))
if (path.dirname(temporary) !== PACKAGE_ROOT) throw new Error('Unexpected test temporary directory')
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.env.DSH_FASTTOOL_CARGO ?? 'cargo', ['test', '--locked', '--release', '--lib', '--manifest-path', 'runtime/Cargo.toml', '--', '--quiet'], {
      cwd: PACKAGE_ROOT, windowsHide: true, stdio: 'inherit', env: { ...process.env, TMP: temporary, TEMP: temporary, TMPDIR: temporary },
    })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) process.exitCode = 1
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
