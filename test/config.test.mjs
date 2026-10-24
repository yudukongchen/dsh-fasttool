import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveConfig } from '../lib/config.js'
import { childEnv, sessionArguments, toToolValue } from '../lib/tools.js'

test('configuration rejects misspellings, bad paths, and timer overflow', () => {
  assert.equal(resolveConfig().required, true)
  for (const input of [{ enableShellTools: true }, { required: 'true' }, { cwd: './local' }, { binaryPath: 42 }, { toolCallTimeoutMs: 0 }, { toolCallTimeoutMs: 2 ** 31 }]) {
    assert.throws(() => resolveConfig(input))
  }
  assert.equal(resolveConfig({ toolCallTimeoutMs: 1234 }).toolCallTimeoutMs, 1234)
})

test('paths use the calling session without changing the host cwd', () => {
  const first = path.resolve('first')
  const second = path.resolve('second')
  const exec = cwd => ({ agent: { session: { header: { cwd } } } })
  assert.equal(sessionArguments('fast-grep', { pattern: 'needle' }, exec(first), second).path, first)
  assert.equal(sessionArguments('fast-glob', { path: 'src' }, exec(second), first).path, path.join(second, 'src'))
  const args = { files: [{ path: 'a.txt', offset: 2 }, { path: path.join(first, 'b.txt') }] }
  const resolved = sessionArguments('fast_inspect_local_file', args, exec(second), first)
  assert.equal(resolved.files[0].path, path.join(second, 'a.txt'))
  assert.equal(resolved.files[1].path, path.join(first, 'b.txt'))
  assert.equal(args.files[0].path, 'a.txt')
  assert.equal(sessionArguments('fast_inspect_local_file', { file_path: 'file:///tmp/a' }, exec(first), second).file_path, 'file:///tmp/a')
})

test('child environment excludes credentials and host facts', () => {
  assert.deepEqual(childEnv({ PATH: 'bin', HOME: '/home', API_KEY: 'fixture', PASSWORD: 'fixture', token: 'fixture', DSH_HOME: 'fixture', UNDEFINED: undefined }), { PATH: 'bin', HOME: '/home' })
})

test('MCP errors remain failures and raw content survives success', () => {
  assert.throws(() => toToolValue({ isError: true, content: [{ type: 'text', text: 'Missing file' }] }), /Missing file/)
  assert.throws(() => toToolValue({ result: 'invalid' }), /content array/)
  const content = [{ type: 'text', text: 'ok' }]
  assert.deepEqual(toToolValue({ content, structuredContent: { count: 1 } }), { content, structuredContent: { count: 1 } })
})
