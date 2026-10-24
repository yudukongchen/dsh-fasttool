import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../lib/index.js'
import { PUBLIC_TOOL_NAMES } from '../lib/index.js'
import { resolveConfig } from '../lib/config.js'
import { resolveBinary } from '../lib/binary.js'
import { FastToolSurface, TOOL_NAMES } from '../lib/tools.js'

const names = ctx => ctx.get('tools').schemas().map(tool => tool.name).sort()
async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for plugin lifecycle')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fasttool-host-')) }

await test('real DSH registration, session directories, prompts, foreign tools, and unload', async () => {
  const cwd = temp()
  const second = temp()
  const ctx = new Context()
  ctx.logger.level = 0
  try {
    fs.writeFileSync(path.join(cwd, 'sample.txt'), 'first session\n')
    fs.writeFileSync(path.join(second, 'sample.txt'), 'second session\n')
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    const foreign = { name: 'foreign', description: 'Foreign tool', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) }
    await ctx.plugin({ inject: ['tools'], apply(inner) { inner.tools.register(foreign) } })
    const fiber = await ctx.plugin(plugin, { cwd, toolCallTimeoutMs: 10_000 })
    await waitFor(() => PUBLIC_TOOL_NAMES.every(name => names(ctx).includes(name)))
    assert.deepEqual(names(ctx), [...PUBLIC_TOOL_NAMES, 'foreign'].sort())
    assert.equal(Object.hasOwn(ctx.get('tools'), 'register'), false)
    for (const name of PUBLIC_TOOL_NAMES) assert.equal(ctx.get('tools').get(name).isConcurrencySafe(), true)
    const lint = ctx.get('tools').get('fast-shellcheck')
    const lintResult = await lint.execute({ script: '#!/bin/bash\necho $name\n' }, { signal: new AbortController().signal })
    assert.ok(lintResult.structuredContent.diagnostics.some(item => item.code === 'SC2086'))
    const definition = ctx.get('tools').get('fast_inspect_local_file')
    const call = async directory => {
      const args = { file_path: 'sample.txt' }
      const exec = { callId: 'test', name: definition.name, arguments: args, agent: { session: { header: { cwd: directory } } }, signal: new AbortController().signal }
      const value = await definition.execute(args, exec)
      return definition.output.render(args, value).map(block => block.text ?? '').join('\n')
    }
    const [firstRead, secondRead] = await Promise.all([call(cwd), call(second)])
    assert.match(firstRead, /first session/)
    assert.match(secondRead, /second session/)
    const assembly = await ctx.get('systemPrompt').assemble({})
    assert.ok(assembly.sections.some(section => section.name === plugin.PROMPT_SECTION && section.text.includes('fast-grep')))
    // SDK presentation must accept hyphenated public tool names too.
    assert.equal(ctx.get('tools').sdkSchemas().filter(schema => PUBLIC_TOOL_NAMES.includes(schema.name)).length, 4)
    await fiber.dispose()
    assert.deepEqual(names(ctx), ['foreign'])
    const after = await ctx.get('systemPrompt').assemble({})
    assert.ok(after.sections.every(section => section.name !== plugin.PROMPT_SECTION))
  } finally {
    await ctx.fiber.dispose()
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(second, { recursive: true, force: true })
  }
})

await test('real runtime crash withdraws tools, reconnects, and closes only the owned process', async () => {
  const registered = new Map()
  const ctx = { tools: { register(definition) {
    assert.ok(!registered.has(definition.name), 'duplicate registration')
    registered.set(definition.name, definition)
    return () => registered.delete(definition.name)
  } } }
  const surface = new FastToolSurface({ ctx, config: resolveConfig({ toolCallTimeoutMs: 10_000 }), binary: resolveBinary() })
  try {
    await surface.start()
    const first = surface.client
    first.child.kill()
    await first.exited
    await waitFor(() => surface.client !== first && surface.client && registered.size === 3)
    assert.deepEqual([...registered.keys()].sort(), [...TOOL_NAMES].sort())
    const owned = surface.client
    await surface.stop()
    assert.ok(owned.exitInfo)
    assert.equal(registered.size, 0)
    await surface.stop()
  } finally { await surface.stop() }
})

await test('stopping during the handshake never publishes late tools', async () => {
  const registered = new Map()
  const ctx = { tools: { register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name) } } }
  const surface = new FastToolSurface({ ctx, config: resolveConfig(), binary: resolveBinary() })
  const starting = surface.start().catch(() => {})
  const client = surface.client
  await surface.stop()
  await starting
  assert.equal(registered.size, 0)
  assert.ok(client.exitInfo)
})
