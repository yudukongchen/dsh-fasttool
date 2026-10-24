import fs from 'node:fs'
import path from 'node:path'
import { resolveBinary, nativeDirectory, PACKAGE_ROOT } from '../lib/binary.js'
import { resolveShellcheck } from '../lib/shellcheck.js'
import { createHash } from 'node:crypto'

resolveBinary({})
const receipt = JSON.parse(fs.readFileSync(path.join(nativeDirectory, 'receipt.json'), 'utf8'))
if (receipt.profile !== 'release' || !receipt.pdf) throw new Error('Package requires a release build with PDF enabled. Run npm run build.')
const runtimeVersion = fs.readFileSync(path.join(PACKAGE_ROOT, 'runtime/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1]
if (receipt.version !== runtimeVersion) throw new Error('Runtime receipt version does not match runtime/Cargo.toml')
resolveShellcheck()
const upstream = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'vendor/shellcheck/UPSTREAM.json'), 'utf8'))
const source = fs.readFileSync(path.join(PACKAGE_ROOT, 'vendor/shellcheck', upstream.source.file))
if (createHash('sha256').update(source).digest('hex') !== upstream.source.sha256) throw new Error('ShellCheck source archive checksum mismatch')
console.error(`Package runtime verified: ${receipt.platform}-${receipt.arch}, sha256 ${receipt.sha256}`)
