import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveBinary, nativeDirectory } from '../lib/binary.js'
import { McpStdioClient } from '../lib/mcp-client.js'
import { childEnv, TOOL_NAMES } from '../lib/tools.js'

const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fasttool-runtime-'))
const client = McpStdioClient.start({ file: resolveBinary(), args: ['serve'], cwd: work, env: childEnv(), timeoutMs: 20_000 })
const receipt = JSON.parse(fs.readFileSync(path.join(nativeDirectory, 'receipt.json'), 'utf8'))

// A small deterministic PDF with an embedded text layer, no external asset.
function pdfFixture() {
  const stream = 'BT /F1 14 Tf 40 100 Td (Fasttool PDF sample) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n', offsets = [0]
  for (const [i, obj] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n` }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

try {
  fs.mkdirSync(path.join(work, '.git'))
  fs.mkdirSync(path.join(work, 'nested'))
  fs.writeFileSync(path.join(work, 'a.txt'), 'alpha\nneedle one\nneedle two\nomega\n')
  fs.writeFileSync(path.join(work, 'b.txt'), 'needle three\n')
  fs.writeFileSync(path.join(work, 'nested', 'c.txt'), 'needle four\n')
  fs.writeFileSync(path.join(work, '.gitignore'), 'ignored.txt\n')
  fs.writeFileSync(path.join(work, 'ignored.txt'), 'secret fixture needle\n')
  fs.writeFileSync(path.join(work, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('编码测试\nneedle utf16\n', 'utf16le')]))
  fs.writeFileSync(path.join(work, 'gbk.txt'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]))
  fs.writeFileSync(path.join(work, 'sample.pdf'), pdfFixture())
  const bmp = Buffer.alloc(58)
  bmp.write('BM'); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22)
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(4, 34); bmp[54] = 255
  fs.writeFileSync(path.join(work, 'pixel.bmp'), bmp)
  const info = await client.initialize()
  await test('only requested tools are published with portable schemas', async () => {
    assert.equal(info.serverInfo.name, 'dsh-fasttool-runtime')
    const tools = await client.listTools()
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort())
    for (const tool of tools) { assert.equal(tool.annotations.readOnlyHint, true); assert.ok(!JSON.stringify(tool.inputSchema).includes('"$ref"')) }
    await assert.rejects(client.callTool('replace', {}), /not found|unknown|Unknown/i)
  })
  await test('grep decodes text and respects gitignore; summary counts occurrences', async () => {
    const result = await client.callTool('fast-grep', { pattern: 'needle', output_mode: 'content', line_numbers: true })
    assert.ok(!result.isError, text(result))
    assert.match(text(result), /needle utf16/)
    assert.match(text(result), /needle one/)
    assert.doesNotMatch(text(result), /secret fixture/)
    const count = await client.callTool('fast-grep', { pattern: 'needle', path: path.join(work, 'a.txt'), output_mode: 'summary' })
    assert.match(text(count), /2/)
  })
  await test('glob supports batch exclusions and resumable pages', async () => {
    const result = await client.callTool('fast-glob', { pattern: ['**/*.txt', '!nested/**'], limit: 1 })
    assert.ok(!result.isError, text(result))
    assert.match(text(result), /Partial/)
    const next = await client.callTool('fast-glob', { pattern: ['**/*.txt', '!nested/**'], limit: 1, offset: 1 })
    assert.ok(!next.isError, text(next))
    assert.notEqual(text(next), text(result))
    const all = await client.callTool('fast-glob', { pattern: ['**/*.txt', '!nested/**'], limit: 100 })
    assert.match(text(all), /ignored\.txt/)
    assert.doesNotMatch(text(all), /c\.txt/)
  })
  await test('inspection supports ranges, batches, encodings, and hex', async () => {
    const result = await client.callTool('fast_inspect_local_file', { files: [{ path: path.join(work, 'a.txt'), offset: 2, limit: 1 }, { path: path.join(work, 'b.txt') }] })
    assert.ok(!result.isError, text(result))
    assert.match(text(result), /needle one/)
    assert.match(text(result), /needle three/)
    assert.doesNotMatch(text(result), /needle two/)
    const gbk = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'gbk.txt'), encoding: 'gbk' })
    assert.match(text(gbk), /中文/)
    const hex = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'gbk.txt'), view: 'hex' })
    assert.match(text(hex), /[dD]6/)
  })
  await test('PDF text and image channels use the bundled engine', async () => {
    const result = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'sample.pdf') })
    if (!receipt.pdf) { assert.equal(result.isError, true); assert.match(text(result), /built without the pdf feature/); return }
    assert.ok(!result.isError, text(result))
    assert.match(text(result), /Fasttool PDF sample/)
    const image = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'sample.pdf'), pdf_mode: 'image', pages: '1' })
    assert.ok(!image.isError, text(image))
    assert.ok(image.content.some(block => block.type === 'image' && block.mimeType === 'image/png'))
  })
  await test('ordinary images are returned as MCP image blocks', async () => {
    const result = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'pixel.bmp') })
    assert.ok(!result.isError, text(result))
    assert.ok(result.content.some(block => block.type === 'image' && block.data.length > 0))
  })
  await test('invalid inputs and missing files fail without killing the server', async () => {
    const missing = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'absent.txt') })
    assert.equal(missing.isError, true)
    const regex = await client.callTool('fast-grep', { pattern: '(?=needle)' })
    assert.equal(regex.isError, true)
    const invalid = await client.callTool('fast_inspect_local_file', { file_path: path.join(work, 'a.txt'), typo: true })
    assert.equal(invalid.isError, true)
    assert.equal((await client.listTools()).length, 3)
  })
} finally {
  await client.close()
  // Only this test's generated directory is removed.
  fs.rmSync(work, { recursive: true, force: true })
}
