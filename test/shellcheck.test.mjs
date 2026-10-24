import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ShellcheckRunner, resolveShellcheck, shellcheckDefinition } from '../lib/shellcheck.js'
import { resolveConfig } from '../lib/config.js'

test('real ShellCheck reports SC diagnostics as successful results and supports filtering', async () => {
  const runner = new ShellcheckRunner()
  try {
    const result = await runner.check({ script: '#!/bin/bash\necho $name\n' })
    assert.equal(result.structuredContent.exit_code, 1)
    assert.equal(result.structuredContent.clean, false)
    const issue = result.structuredContent.diagnostics.find(item => item.code === 'SC2086')
    assert.equal(issue.line, 2)
    assert.ok(issue.column > 0)
    assert.match(result.content[0].text, /SC2086/)
    assert.equal((await runner.check({ script: '#!/bin/bash\necho $name\n', exclude: ['SC2086', 'SC2154'] })).structuredContent.clean, true)
    assert.equal((await runner.check({ script: '#!/bin/bash\necho "$HOME"\n' })).structuredContent.clean, true)
    const errorOnly = await runner.check({ script: '#!/bin/bash\necho $name\n', severity: 'error' })
    assert.ok(errorOnly.structuredContent.diagnostics.every(issue => issue.level === 'error'))
  } finally { await runner.stop() }
})

test('scripts are never executed; relative paths follow session cwd; rc and environment flags are ignored', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-shellcheck-'))
  const runner = new ShellcheckRunner({ cwd: process.cwd() })
  const previous = process.env.SHELLCHECK_OPTS
  try {
    const marker = path.join(cwd, 'executed.txt').replaceAll('\\', '/')
    fs.writeFileSync(path.join(cwd, 'lint.sh'), `#!/bin/bash\nprintf evil > '${marker}'\necho $name\n`)
    fs.writeFileSync(path.join(cwd, '.shellcheckrc'), 'disable=SC2086,SC2154\n')
    process.env.SHELLCHECK_OPTS = '--exclude=SC2086,SC2154'
    const result = await runner.check({ file_path: 'lint.sh' }, { agent: { session: { header: { cwd } } } })
    assert.ok(result.structuredContent.diagnostics.some(item => item.code === 'SC2086' && item.file === path.join(cwd, 'lint.sh')))
    assert.equal(fs.existsSync(path.join(cwd, 'executed.txt')), false)
  } finally {
    if (previous === undefined) delete process.env.SHELLCHECK_OPTS; else process.env.SHELLCHECK_OPTS = previous
    await runner.stop()
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('dialects, parse failures, Unicode, and diagnostic truncation are handled', async () => {
  const runner = new ShellcheckRunner()
  try {
    const bash = await runner.check({ script: '[[ -n "$HOME" ]]\n', shell: 'bash' })
    assert.equal(bash.structuredContent.clean, true)
    const sh = await runner.check({ script: '[[ -n "$HOME" ]]\n', shell: 'sh' })
    assert.ok(sh.structuredContent.diagnostics.length > 0)
    const broken = await runner.check({ script: 'if true; then\necho hi\n' })
    assert.ok(broken.structuredContent.diagnostics.some(item => item.level === 'error'))
    const unicode = await runner.check({ script: 'echo $中文\necho $other\n', max_diagnostics: 1 })
    assert.equal(unicode.structuredContent.diagnostics.length, 1)
    assert.equal(unicode.structuredContent.truncated, true)
    assert.doesNotMatch(unicode.content[0].text, /\uFFFD/)
  } finally { await runner.stop() }
})

test('invalid arguments, missing files, oversized inputs and bad executables fail clearly', async () => {
  const runner = new ShellcheckRunner()
  try {
    for (const args of [{}, { script: '', file_path: 'a.sh' }, { script: '', shell: 'pwsh' }, { script: '', extra_args: ['-x'] }, { script: '', exclude: ['2086'] }, { script: '', max_diagnostics: 501 }, { script: '', severity: 'invalid' }, { file_path: 'file:///script.sh' }]) await assert.rejects(runner.check(args))
    await assert.rejects(runner.check({ script: 'x'.repeat(2 * 1024 * 1024 + 1) }), /2 MiB/)
    await assert.rejects(runner.check({ file_path: path.join(process.cwd(), 'no-such-script.sh') }), /ENOENT/)
    const invalid = new ShellcheckRunner({ shellcheckPath: path.join(process.cwd(), 'no-such-executable.exe') })
    try { await assert.rejects(invalid.check({ script: '' }), /not found/) } finally { await invalid.stop() }
    assert.throws(() => resolveConfig({ shellcheckPath: 'relative.exe' }), /absolute path/)
    assert.ok(path.isAbsolute(resolveShellcheck()))
  } finally { await runner.stop() }
})

test('abort, timeout, and disposal stop calls and reject late work', async () => {
  const runner = new ShellcheckRunner({ toolCallTimeoutMs: 1 })
  try {
    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))
    await assert.rejects(runner.check({ script: 'echo hi' }, { signal: controller.signal }), /cancelled by test/)
    await assert.rejects(runner.check({ script: 'echo $name\n'.repeat(20_000) }), /timed out/)
    const pending = runner.check({ script: 'echo $name\n'.repeat(20_000) })
    const rejected = assert.rejects(pending, /disposed/)
    await runner.stop()
    await rejected
    await assert.rejects(runner.check({ script: '' }), /stopped/)
    assert.equal(runner.controllers.size, 0)
  } finally { await runner.stop() }
})

test('DSH declaration exposes the exact name and canonical diagnostic result', async () => {
  const runner = new ShellcheckRunner()
  try {
    const tool = shellcheckDefinition(runner)
    assert.equal(tool.name, 'fast-shellcheck')
    assert.equal(tool.isConcurrencySafe(), true)
    const result = await tool.execute({ script: 'echo "$HOME"\n' }, {})
    assert.match(tool.output.render({}, result)[0].text, /no issues/)
  } finally { await runner.stop() }
})

test('parallel checks are bounded and disposal drains every owned call', async () => {
  const runner = new ShellcheckRunner()
  const calls = Array.from({ length: 4 }, () => runner.check({ script: 'echo $name\n'.repeat(1000) }))
  const settled = Promise.allSettled(calls)
  await assert.rejects(runner.check({ script: 'echo hi' }), /At most 4/)
  await runner.stop()
  await settled
  assert.equal(runner.pending.size, 0)
  assert.equal(runner.controllers.size, 0)
})
