import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { McpStdioClient, McpTimeoutError } from '../lib/mcp-client.js'

const fixture = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))
function start() { return McpStdioClient.start({ file: process.execPath, args: [fixture], timeoutMs: 2_000 }) }

test('transport correlates overlapping requests, reports errors, and reaps its child', async () => {
  const client = start()
  try {
    await client.initialize()
    const [slow, fast] = await Promise.all([client.request('echo', { id: 'slow', delay: 40 }), client.request('echo', { id: 'fast' })])
    assert.equal(slow.id, 'slow')
    assert.equal(fast.id, 'fast')
    await assert.rejects(client.request('fail'), /Fixture failure/)
    assert.equal(client.pending.size, 0)
  } finally { await client.close() }
  assert.ok(client.exitInfo)
  await client.close()
})

test('timeout and abort cancel requests without poisoning the next reply', async () => {
  const client = start()
  try {
    await client.initialize()
    await assert.rejects(client.request('never', {}, { timeoutMs: 20 }), McpTimeoutError)
    const abort = new AbortController()
    const pending = client.request('never', {}, { signal: abort.signal })
    abort.abort()
    await assert.rejects(pending, /canceled/)
    assert.deepEqual(await client.request('echo', { next: true }), { next: true })
    assert.ok(client.stderrLines.some(line => line.startsWith('cancelled:')))
    assert.equal(client.pending.size, 0)
  } finally { await client.close() }
})

test('server crash rejects in-flight requests immediately', async () => {
  const client = start()
  await client.initialize()
  await assert.rejects(client.request('crash'), /exited|closing/)
  await client.exited
  assert.equal(client.pending.size, 0)
  await client.close()
})
