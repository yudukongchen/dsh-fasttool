import path from 'node:path'

const DEFAULTS = Object.freeze({ promptPolicy: true, required: true, toolCallTimeoutMs: 300_000 })
const ALLOWED = new Set([...Object.keys(DEFAULTS), 'binaryPath', 'cwd', 'shellcheckPath'])

export function resolveConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('dsh-fasttool config must be an object')
  for (const key of Object.keys(raw)) if (!ALLOWED.has(key)) throw new Error(`Unknown dsh-fasttool config key: ${key}`)
  const config = { ...DEFAULTS, ...raw }
  for (const key of ['promptPolicy', 'required']) {
    if (typeof config[key] !== 'boolean') throw new TypeError(`${key} must be boolean`)
  }
  if (!Number.isSafeInteger(config.toolCallTimeoutMs) || config.toolCallTimeoutMs < 1 || config.toolCallTimeoutMs > 2_147_483_647) {
    throw new TypeError('toolCallTimeoutMs must be an integer from 1 to 2147483647')
  }
  for (const key of ['binaryPath', 'cwd', 'shellcheckPath']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !path.isAbsolute(config[key]))) {
      throw new TypeError(`${key} must be an absolute path`)
    }
  }
  return Object.freeze(config)
}
