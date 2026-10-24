import test from 'node:test'
import assert from 'node:assert/strict'
import { toolDefinition, renderContent } from '../lib/tools.js'

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
const value = { content: [{ type: 'text', text: 'before' }, image, { type: 'text', text: 'after' }] }
const tool = { name: 'fast_inspect_local_file', inputSchema: { type: 'object' } }
const exec = () => ({ agent: { options: { provider: 'fixture', model: 'vision' } }, signal: new AbortController().signal })

test('image content uses durable DSH references and preserves ordering', async () => {
  let saved
  const ctx = { get: key => key === 'llm' ? { resolveModelInfo: async () => ({ inputModalities: ['image'] }) }
    : key === 'attachments' ? { saveImages: async images => { saved = images; return [{ id: 'fixture-image' }] } } : undefined }
  const definition = toolDefinition(tool, async () => value, ctx)
  const execution = exec()
  const result = await definition.execute({}, execution)
  const fallback = definition.output.render({}, result)
  assert.ok(fallback.every(block => block.type === 'text'))
  const content = definition.projectContent(execution, { value: result, content: fallback, isError: false })
  assert.deepEqual(content, [{ type: 'text', text: 'before' }, { type: 'image', attachment: { id: 'fixture-image' } }, { type: 'text', text: 'after' }])
  assert.equal(saved[0].data.toString(), 'hello')
  assert.equal(result.content[1].data, image.data)
})

test('missing image capability yields an explicit text diagnostic', async () => {
  const definition = toolDefinition(tool, async () => value)
  const execution = exec()
  const result = await definition.execute({}, execution)
  const fallback = renderContent(result.content)
  const content = definition.projectContent(execution, { value: result, content: fallback })
  assert.ok(content.every(block => block.type === 'text'))
  assert.match(content[1].text, /Image unavailable/)
})

test('policy-modified results cannot recover hidden images', async () => {
  const definition = toolDefinition(tool, async () => value)
  const execution = exec()
  const result = await definition.execute({}, execution)
  assert.equal(definition.projectContent(execution, { value: result, content: [{ type: 'text', text: 'policy replacement' }] }), undefined)
})
