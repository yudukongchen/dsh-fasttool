import { resolveConfig } from './config.js'
import { resolveBinary } from './binary.js'
import { FastToolSurface, TOOL_NAMES } from './tools.js'
import { ShellcheckRunner, shellcheckDefinition, SHELLCHECK_TOOL } from './shellcheck.js'

export const PUBLIC_TOOL_NAMES = Object.freeze([...TOOL_NAMES, SHELLCHECK_TOOL])

export const name = 'dsh-fasttool'
export const PROMPT_SECTION = 'dsh-fasttool:files'
export const GUIDANCE = 'Use fast-grep for content search, fast-glob for path discovery, fast_inspect_local_file for reading, and fast-shellcheck for static Bash/POSIX script diagnostics without executing scripts. Prefer batched glob patterns and files[] text ranges. Use summary/count/files_with_matches when full content is unnecessary. Relative paths use the calling session directory. Follow returned Complete/Partial and continuation markers. These tools read files with the host user permissions; they do not use the DSH filesystem sandbox.'

export function apply(root, rawConfig) {
  const config = resolveConfig(rawConfig)
  const report = (message, level = 'error') => {
    const logger = root.logger
    if (typeof logger?.[level] === 'function') logger[level](message)
  }
  if (config.promptPolicy) root.inject(['systemPrompt', 'tools'], ctx => {
    ctx.effect(() => ctx.systemPrompt.section({ name: PROMPT_SECTION, order: 3250, interpolate: false,
      text: ({ agent }) => ctx.get('tools').schemas(agent).some(tool => PUBLIC_TOOL_NAMES.includes(tool.name)) ? GUIDANCE : '',
    }), 'dsh-fasttool: file guidance')
  })
  root.inject(['tools'], async ctx => {
    let surface
    try {
      const shellcheck = new ShellcheckRunner(config)
      ctx.effect(() => () => shellcheck.stop(), 'dsh-fasttool: shellcheck processes')
      ctx.tools.register(shellcheckDefinition(shellcheck, ctx))
      surface = new FastToolSurface({ ctx, config, binary: resolveBinary(config), report })
      ctx.effect(() => () => surface.stop(), 'dsh-fasttool: runtime')
      await surface.start()
      report(`dsh-fasttool ready: ${PUBLIC_TOOL_NAMES.join(', ')}`, 'info')
    } catch (error) {
      report(`dsh-fasttool: ${error.message}`)
      if (config.required) { await surface?.stop(); throw error }
      surface?.retryLater()
    }
  })
}
