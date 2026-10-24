import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PACKAGE_ROOT } from '../lib/binary.js'
import { resolveShellcheck, SHELLCHECK_DIRECTORY, SHELLCHECK_VERSION } from '../lib/shellcheck.js'

export async function buildShellcheck() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Bundled ShellCheck provisioning currently supports Windows x64. Configure shellcheckPath for other platforms.')
  const upstream = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'vendor/shellcheck/UPSTREAM.json'), 'utf8'))
  try { resolveShellcheck(); console.log(`ShellCheck ${SHELLCHECK_VERSION} already verified.`); return } catch {}
  const temporary = fs.mkdtempSync(path.join(PACKAGE_ROOT, '.tmp-shellcheck-'))
  if (path.dirname(temporary) !== PACKAGE_ROOT) throw new Error('Unexpected ShellCheck staging path')
  try {
    let archive = process.env.DSH_FASTTOOL_SHELLCHECK_ARCHIVE
    if (!archive) {
      archive = path.join(temporary, 'shellcheck.zip')
      const response = await fetch(upstream.binary.url, { signal: AbortSignal.timeout(600_000) })
      if (!response.ok) throw new Error(`ShellCheck download returned HTTP ${response.status}`)
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 32 * 1024 * 1024) throw new Error('ShellCheck archive exceeds 32 MiB')
        chunks.push(chunk)
      }
      fs.writeFileSync(archive, Buffer.concat(chunks))
    }
    const archiveBytes = fs.readFileSync(archive)
    if (createHash('sha256').update(archiveBytes).digest('hex') !== upstream.binary.sha256) throw new Error('ShellCheck archive SHA-256 does not match the pinned official release')
    const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
    const members = listing.filter(name => /(^|\/)shellcheck\.exe$/i.test(name) && !name.split('/').includes('..'))
    if (members.length !== 1) throw new Error('Expected exactly one shellcheck.exe in the verified release archive')
    const bytes = execFileSync('tar', ['-xOf', archive, members[0]], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    const staged = path.join(temporary, 'shellcheck.exe')
    fs.writeFileSync(staged, bytes)
    const version = execFileSync(staged, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    if (!version.includes(`version: ${SHELLCHECK_VERSION}`)) throw new Error('Unexpected ShellCheck executable version')
    fs.mkdirSync(SHELLCHECK_DIRECTORY, { recursive: true })
    fs.copyFileSync(staged, path.join(SHELLCHECK_DIRECTORY, 'shellcheck.exe'))
    fs.writeFileSync(path.join(SHELLCHECK_DIRECTORY, 'receipt.json'), JSON.stringify({
      version: SHELLCHECK_VERSION, platform: process.platform, arch: process.arch,
      sha256: createHash('sha256').update(bytes).digest('hex'), archiveSha256: upstream.binary.sha256,
    }, null, 2) + '\n')
    resolveShellcheck()
    console.log(`Provisioned ShellCheck ${SHELLCHECK_VERSION}: ${SHELLCHECK_DIRECTORY}`)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildShellcheck()
