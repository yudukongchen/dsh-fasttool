import { isDeepStrictEqual } from 'node:util'

// DSH model content uses durable attachment references, not raw MCP base64 blocks.
export function renderContent(content) {
  return content.map(block => block?.type === 'text'
    ? { type: 'text', text: block.text }
    : { type: 'text', text: block?.type === 'image'
      ? '[Image requires a DSH attachment store and an image-capable model; raw MCP image remains available in the canonical result.]'
      : `[Unsupported MCP content: ${block?.type ?? 'unknown'}]` })
}

export async function projectImages(ctx, exec, content) {
  const images = content.filter(block => block?.type === 'image')
  if (!images.length) return renderContent(content)
  const diagnostic = reason => content.map(block => block?.type === 'image'
    ? { type: 'text', text: `[Image unavailable: ${reason}; raw MCP image remains available in the canonical result.]` }
    : renderContent([block])[0])
  const attachments = ctx?.get?.('attachments')
  const llm = ctx?.get?.('llm')
  if (!attachments || !llm || !exec?.agent) return diagnostic('no attachment store or model route')
  try {
    const routed = exec.agent.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec.agent.options?.provider
    const model = routed?.model ?? exec.agent.options?.model
    if (provider === undefined || model === undefined) return diagnostic('model route cannot be resolved')
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    if (!info?.inputModalities?.includes('image')) return diagnostic('current model does not declare image input')
    exec.signal?.throwIfAborted()
    const decoded = images.map(block => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mimeType)) throw new Error('unsupported media type')
      if (typeof block.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data)) throw new Error('invalid image encoding')
      const data = Buffer.from(block.data, 'base64')
      if (data.toString('base64') !== block.data) throw new Error('invalid image encoding')
      return { data, mediaType: block.mimeType }
    })
    const refs = await attachments.saveImages(decoded)
    let index = 0
    return content.map(block => block?.type === 'image'
      ? { type: 'image', attachment: refs[index++] }
      : renderContent([block])[0])
  } catch {
    exec.signal?.throwIfAborted()
    return diagnostic('model verification or durable image admission failed')
  }
}

export function imageProjection(ctx, call) {
  const projections = new WeakMap()
  return {
    async execute(args, exec) {
      const value = await call(args, exec)
      if (value.content.some(block => block?.type === 'image') && exec && typeof exec === 'object') {
        const content = await projectImages(ctx, exec, value.content)
        projections.set(exec, { value: structuredClone(value), fallback: renderContent(value.content), content })
      }
      return value
    },
    projectContent(exec, result) {
      const projection = projections.get(exec)
      projections.delete(exec)
      if (!projection || result.isError || !isDeepStrictEqual(result.value, projection.value) || !isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}
