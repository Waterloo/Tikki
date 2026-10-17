// nitropack is not a direct dependency, so TypeScript cannot find it. The Nitro build resolves this import itself.
declare module 'nitropack/presets/cloudflare/runtime/cloudflare-module' {
  const handler: ExportedHandler<Record<string, unknown>>
  export default handler
}
