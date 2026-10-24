import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const executableName = process.platform === 'win32' ? 'dsh-fasttool-runtime.exe' : 'dsh-fasttool-runtime'
export const nativeDirectory = path.join(PACKAGE_ROOT, 'native', `${process.platform}-${process.arch}`)

export function resolveBinary(config = {}) {
  const explicit = config.binaryPath ?? process.env.DSH_FASTTOOL_BINARY
  const file = explicit ? path.resolve(explicit) : path.join(nativeDirectory, executableName)
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`dsh-fasttool runtime missing at ${file}. Run npm run build in the source checkout, or set binaryPath to a built dsh-fasttool-runtime.`)
  }
  if (!explicit) {
    const receipt = JSON.parse(fs.readFileSync(path.join(nativeDirectory, 'receipt.json'), 'utf8'))
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if (receipt.sha256 !== sha256 || receipt.platform !== process.platform || receipt.arch !== process.arch) {
      throw new Error('dsh-fasttool bundled runtime does not match its build receipt; rebuild or reinstall the package')
    }
  }
  return file
}
