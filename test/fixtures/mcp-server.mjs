import readline from 'node:readline'
const input = readline.createInterface({ input: process.stdin })
input.on('line', line => {
  const msg = JSON.parse(line)
  const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  if (msg.method === 'initialize') reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'fixture', version: '1' }, capabilities: {} })
  if (msg.method === 'tools/list') reply({ tools: [] })
  if (msg.method === 'echo') setTimeout(() => reply(msg.params), msg.params.delay ?? 0)
  if (msg.method === 'fail') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Fixture failure' } }) + '\n')
  if (msg.method === 'crash') process.exit(3)
  if (msg.method === 'notifications/cancelled') process.stderr.write('cancelled:' + msg.params.requestId + '\n')
})
