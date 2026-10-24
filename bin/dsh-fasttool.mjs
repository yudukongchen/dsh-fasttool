#!/usr/bin/env node
import { resolveBinary } from '../lib/binary.js'
import { McpStdioClient } from '../lib/mcp-client.js'
import { childEnv, TOOL_NAMES } from '../lib/tools.js'
import { PUBLIC_TOOL_NAMES } from '../lib/index.js'
import { resolveShellcheck, SHELLCHECK_VERSION } from '../lib/shellcheck.js'
import { execFileSync } from 'node:child_process'

const [command = 'help', ...args] = process.argv.slice(2)
if (command === 'build') {
  if (args.some(arg => !['--no-pdf', '--debug'].includes(arg))) throw new Error('Usage: dsh-fasttool build [--no-pdf] [--debug]')
  const { build } = await import('../scripts/build.mjs')
  await build({ pdf: !args.includes('--no-pdf'), debug: args.includes('--debug') })
} else if (command === 'status') {
  if (args.length) throw new Error('Usage: dsh-fasttool status')
  const client = McpStdioClient.start({ file: resolveBinary(), args: ['serve'], env: childEnv(), timeoutMs: 30_000 })
  try {
    const info = await client.initialize('dsh-fasttool-status')
    if (info.serverInfo?.name !== 'dsh-fasttool-runtime') throw new Error('Unexpected runtime identity')
    const tools = (await client.listTools()).map(tool => tool.name).sort()
    if (JSON.stringify(tools) !== JSON.stringify([...TOOL_NAMES].sort())) throw new Error('Unexpected runtime tool list')
    const shellcheck = resolveShellcheck()
    const version = execFileSync(shellcheck, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    console.log(JSON.stringify({ runtime: info.serverInfo, shellcheck: { version: version.match(/version: (\S+)/)?.[1] ?? SHELLCHECK_VERSION }, tools: [...PUBLIC_TOOL_NAMES].sort() }, null, 2))
  } finally { await client.close() }
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log('dsh-fasttool build [--no-pdf] [--debug]\ndsh-fasttool status\n\nInstall a built package with the official DSH plugin CLI. See README.md.')
} else {
  console.error(`Unknown command: ${command}`)
  process.exitCode = 2
}
