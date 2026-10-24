import path from 'node:path'
import { McpStdioClient } from './mcp-client.js'
import { renderContent, imageProjection } from './images.js'
export { renderContent } from './images.js'

export const TOOL_NAMES = Object.freeze(['fast-grep', 'fast-glob', 'fast_inspect_local_file'])

export function childEnv(parent = process.env) {
  return Object.fromEntries(Object.entries(parent).filter(([key, value]) => value !== undefined
    && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !/^DSH_/i.test(key)))
}

export function toToolValue(result) {
  if (!result || !Array.isArray(result.content)) throw new Error('Invalid MCP result: expected content array')
  if (result.isError) throw new Error(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n') || 'File operation failed')
  return { content: result.content, ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }) }
}

// Each DSH session may have its own cwd. Resolve in arguments, never mutate process.cwd().
export function sessionArguments(name, args, exec, fallbackCwd) {
  const cwd = exec?.agent?.session?.header?.cwd ?? fallbackCwd
  const resolve = value => typeof value === 'string' && !path.isAbsolute(value) && !/^file:/i.test(value) ? path.resolve(cwd, value) : value
  if (name === 'fast_inspect_local_file') {
    return { ...args, ...(args.file_path === undefined ? {} : { file_path: resolve(args.file_path) }),
      ...(Array.isArray(args.files) ? { files: args.files.map(entry => ({ ...entry, path: resolve(entry.path) })) } : {}) }
  }
  return { ...args, path: resolve(args.path ?? cwd) }
}

export function toolDefinition(tool, call, ctx, timeoutMs) {
  return {
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    isConcurrencySafe: () => true,
    output: {
      schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
      render: (_args, value) => renderContent(value.content),
    },
    ...imageProjection(ctx, call),
  }
}

export class FastToolSurface {
  constructor({ ctx, config, binary, report = () => {} }) {
    this.ctx = ctx
    this.config = config
    this.binary = binary
    this.report = report
    this.cwd = config.cwd ?? process.cwd()
    this.disposers = []
    this.stopped = false
    this.retries = 0
    this.client = undefined
    this.timer = undefined
    this.connecting = undefined
  }

  start() {
    if (this.stopped) return Promise.reject(new Error('dsh-fasttool has stopped'))
    return this.connecting ??= this.connect().finally(() => { this.connecting = undefined })
  }

  async connect() {
    const client = McpStdioClient.start({ file: this.binary, args: ['serve'], cwd: this.cwd,
      env: childEnv(), timeoutMs: this.config.toolCallTimeoutMs })
    this.client = client
    let ready = false
    void client.exited.then(() => {
      if (this.client !== client || this.stopped) return
      this.unpublish()
      if (ready) { this.report('dsh-fasttool runtime exited; reconnecting.', 'warn'); this.retryLater() }
    })
    try {
      const info = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-fasttool', version: '0.1.0' } }, { timeoutMs: 30_000 })
      if (info?.serverInfo?.name !== 'dsh-fasttool-runtime') throw new Error('binaryPath must point to the dedicated dsh-fasttool-runtime')
      client.notify('notifications/initialized')
      const list = await client.request('tools/list', {}, { timeoutMs: 30_000 })
      const tools = list?.tools
      if (!Array.isArray(tools) || tools.length !== TOOL_NAMES.length || new Set(tools.map(tool => tool.name)).size !== TOOL_NAMES.length || tools.some(tool => !TOOL_NAMES.includes(tool.name))) {
        throw new Error(`Unexpected runtime tool surface; expected exactly ${TOOL_NAMES.join(', ')}`)
      }
      if (this.stopped || client.closed) throw new Error('dsh-fasttool stopped while connecting')
      this.unpublish()
      for (const tool of tools) {
        this.disposers.push(this.ctx.tools.register(toolDefinition(tool, async (args, exec) => {
          if (this.stopped || this.client !== client || client.closed) throw new Error('dsh-fasttool runtime is unavailable')
          const result = await client.callTool(tool.name, sessionArguments(tool.name, args, exec, this.cwd), { signal: exec?.signal })
          return toToolValue(result)
        }, this.ctx, this.config.toolCallTimeoutMs)))
      }
      ready = true
      return tools.map(tool => tool.name)
    } catch (error) {
      this.unpublish()
      if (this.client === client) this.client = undefined
      await client.close()
      throw error
    }
  }

  retryLater() {
    if (this.stopped || this.timer) return
    if (this.retries >= 5) {
      this.report('dsh-fasttool reconnect limit reached (5 attempts); reload the plugin to retry.', 'error')
      return
    }
    const delay = Math.min(500 * 2 ** this.retries++, 8_000)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.start().catch(error => { this.report(`dsh-fasttool reconnect failed: ${error.message}`, 'warn'); this.retryLater() })
    }, delay)
    this.timer.unref?.()
  }

  unpublish() {
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
  }

  async stop() {
    if (this.stopped) return this.stopping
    this.stopped = true
    clearTimeout(this.timer)
    this.unpublish()
    this.stopping = this.client?.close()
    await this.stopping
    await this.connecting?.catch(() => {})
  }
}
