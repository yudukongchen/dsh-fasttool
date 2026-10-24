import fs from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { PACKAGE_ROOT } from './binary.js'
import { childEnv, toolDefinition } from './tools.js'

export const SHELLCHECK_TOOL = 'fast-shellcheck'
export const SHELLCHECK_VERSION = '0.11.0'
export const SHELLCHECK_DIRECTORY = path.join(PACKAGE_ROOT, 'native', 'shellcheck', `${process.platform}-${process.arch}`)
const MAX_INPUT_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const LEVELS = ['error', 'warning', 'info', 'style']
const ownedChildren = new Set()
function reapChildren() { for (const child of ownedChildren) child.kill() }

export function resolveShellcheck(config = {}) {
  if (config.shellcheckPath) {
    if (!fs.statSync(config.shellcheckPath, { throwIfNoEntry: false })?.isFile()) throw new Error(`ShellCheck executable not found: ${config.shellcheckPath}`)
    return config.shellcheckPath
  }
  const file = path.join(SHELLCHECK_DIRECTORY, process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck')
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Bundled ShellCheck is unavailable. Run npm run build:shellcheck on Windows x64, or set shellcheckPath to an absolute ShellCheck executable path.')
  }
  const receipt = JSON.parse(fs.readFileSync(path.join(SHELLCHECK_DIRECTORY, 'receipt.json'), 'utf8'))
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (receipt.sha256 !== digest || receipt.version !== SHELLCHECK_VERSION || receipt.platform !== process.platform || receipt.arch !== process.arch) {
    throw new Error('Bundled ShellCheck does not match its receipt; rebuild or reinstall the plugin')
  }
  return file
}

function validate(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('ShellCheck arguments must be an object')
  const allowed = ['file_path', 'script', 'shell', 'severity', 'exclude', 'max_diagnostics']
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown fast-shellcheck argument: ${key}`)
  if ((args.file_path !== undefined) === (args.script !== undefined)) throw new Error('Provide exactly one of file_path or script')
  if (args.file_path !== undefined && (typeof args.file_path !== 'string' || !args.file_path || args.file_path.includes('\0') || /^file:/i.test(args.file_path))) throw new Error('file_path must be a non-empty local path, not a URI')
  if (args.script !== undefined && typeof args.script !== 'string') throw new Error('script must be a string')
  if (args.shell !== undefined && !['bash', 'sh', 'dash', 'ksh'].includes(args.shell)) throw new Error('shell must be bash, sh, dash, or ksh')
  if (args.severity !== undefined && !LEVELS.includes(args.severity)) throw new Error('severity must be error, warning, info, or style')
  if (args.exclude !== undefined && (!Array.isArray(args.exclude) || args.exclude.length > 100 || args.exclude.some(code => typeof code !== 'string' || !/^SC\d{4}$/.test(code)))) throw new Error('exclude must be an array of at most 100 SC codes, such as SC2086')
  if (args.max_diagnostics !== undefined && (!Number.isInteger(args.max_diagnostics) || args.max_diagnostics < 1 || args.max_diagnostics > 500)) throw new Error('max_diagnostics must be an integer from 1 to 500')
}

async function inputBytes(args, cwd, signal) {
  if (args.script !== undefined) {
    const bytes = Buffer.from(args.script, 'utf8')
    if (bytes.length > MAX_INPUT_BYTES) throw new Error('Script exceeds the 2 MiB input limit')
    return { bytes, file: '<stdin>' }
  }
  const file = path.resolve(cwd, args.file_path)
  const stat = await fs.promises.stat(file)
  if (!stat.isFile()) throw new Error(`Not a regular script file: ${file}`)
  if (stat.size > MAX_INPUT_BYTES) throw new Error('Script exceeds the 2 MiB input limit')
  const chunks = []
  let size = 0
  for await (const chunk of createReadStream(file, { signal })) {
    size += chunk.length
    if (size > MAX_INPUT_BYTES) throw new Error('Script exceeds the 2 MiB input limit')
    chunks.push(chunk)
  }
  return { bytes: Buffer.concat(chunks), file }
}

export class ShellcheckRunner {
  constructor(config = {}) { this.config = config; this.controllers = new Set(); this.pending = new Set(); this.stopped = false }

  check(args, exec = {}) {
    const call = this.perform(args, exec)
    this.pending.add(call)
    void call.then(() => this.pending.delete(call), () => this.pending.delete(call))
    return call
  }

  async perform(args, exec = {}) {
    validate(args)
    if (this.stopped) throw new Error('fast-shellcheck has stopped')
    if (this.controllers.size >= 4) throw new Error('At most 4 ShellCheck calls may run concurrently; retry after a current call completes')
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeoutMs = Math.min(this.config.toolCallTimeoutMs ?? 30_000, 30_000)
    const timer = setTimeout(() => controller.abort(new Error(`ShellCheck timed out after ${timeoutMs} ms`)), timeoutMs)
    const signal = exec.signal ? AbortSignal.any([exec.signal, controller.signal]) : controller.signal
    try {
      signal.throwIfAborted()
      const cwd = exec.agent?.session?.header?.cwd ?? this.config.cwd ?? process.cwd()
      const input = await inputBytes(args, cwd, signal)
      signal.throwIfAborted()
      const argv = ['--norc', '--format=json1', `--shell=${args.shell ?? 'bash'}`, `--severity=${args.severity ?? 'style'}`]
      if (args.exclude?.length) argv.push(`--exclude=${args.exclude.map(code => code.slice(2)).join(',')}`)
      argv.push('-')
      const env = Object.fromEntries(Object.entries(childEnv()).filter(([key]) => !/^SHELLCHECK_/i.test(key)))
      const result = await this.run(resolveShellcheck(this.config), argv, input.bytes, cwd, env, signal)
      if (![0, 1].includes(result.code)) throw new Error(`ShellCheck failed (exit ${result.code}): ${result.stderr.trim().slice(0, 2000)}`)
      let parsed
      try { parsed = JSON.parse(result.stdout) } catch { throw new Error('ShellCheck returned invalid JSON') }
      if (!Array.isArray(parsed.comments)) throw new Error('ShellCheck returned JSON without comments')
      const limit = args.max_diagnostics ?? 100
      const diagnostics = parsed.comments.slice(0, limit).map(item => ({
        file: item.file === '-' ? input.file : item.file,
        line: item.line, column: item.column, endLine: item.endLine, endColumn: item.endColumn,
        level: item.level, code: `SC${item.code}`, message: item.message,
      }))
      const structuredContent = { checker: 'ShellCheck', exit_code: result.code, clean: result.code === 0,
        total_diagnostics: parsed.comments.length, truncated: diagnostics.length < parsed.comments.length, diagnostics }
      const lines = diagnostics.map(item => `${JSON.stringify(item.file)}:${item.line}:${item.column} ${item.level} ${item.code}: ${item.message}`)
      const summary = parsed.comments.length === 0 ? 'ShellCheck: no issues found.'
        : `ShellCheck: ${parsed.comments.length} diagnostic(s); showing ${diagnostics.length}${structuredContent.truncated ? ' (truncated; raise max_diagnostics up to 500)' : ''}.`
      return { content: [{ type: 'text', text: [summary, ...lines].join('\n') }], structuredContent }
    } finally { clearTimeout(timer); this.controllers.delete(controller) }
  }

  run(file, args, input, cwd, env, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], signal })
      if (ownedChildren.size === 0) process.on('exit', reapChildren)
      ownedChildren.add(child)
      let stdout = '', stderr = '', bytes = 0, failure
      child.on('error', error => { failure ??= signal.aborted ? signal.reason : error })
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ??= error })
      const collect = which => chunk => {
        bytes += Buffer.byteLength(chunk, 'utf8')
        if (bytes > MAX_OUTPUT_BYTES) { failure ??= new Error('ShellCheck output exceeds the 4 MiB limit'); child.kill(); return }
        if (which === 'stdout') stdout += chunk; else stderr += chunk
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', collect('stdout'))
      child.stderr.on('data', collect('stderr'))
      child.once('close', code => {
        ownedChildren.delete(child)
        if (ownedChildren.size === 0) process.removeListener('exit', reapChildren)
        failure ? reject(failure) : resolve({ code, stdout, stderr })
      })
      child.stdin.end(input)
    })
  }

  stop() {
    this.stopped = true
    for (const controller of this.controllers) controller.abort(new Error('fast-shellcheck plugin disposed'))
    return Promise.allSettled([...this.pending])
  }
}

export function shellcheckDefinition(runner, ctx) {
  return toolDefinition({ name: SHELLCHECK_TOOL,
    description: 'Statically check Bash/POSIX shell scripts with ShellCheck; does not execute or modify scripts. Pass exactly one of file_path (relative to the session cwd) or script. Returns SC codes, severity and line/column locations; warnings are successful diagnostic results. Project .shellcheckrc files are ignored.',
    inputSchema: { type: 'object', properties: {
      file_path: { type: 'string', description: 'Local script path; exclusive with script.' },
      script: { type: 'string', description: 'Script source to check without writing a file; exclusive with file_path. Maximum 2 MiB UTF-8.' },
      shell: { type: 'string', enum: ['bash', 'sh', 'dash', 'ksh'], description: 'Target dialect; defaults to bash.' },
      severity: { type: 'string', enum: LEVELS, description: 'Minimum severity to report; defaults to style (all levels).' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'SC codes to exclude, e.g. ["SC2086"].' },
      max_diagnostics: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum diagnostics returned; defaults to 100.' },
    } },
  }, (args, exec) => runner.check(args, exec), ctx, Math.min(runner.config.toolCallTimeoutMs ?? 30_000, 30_000) + 1000)
}
