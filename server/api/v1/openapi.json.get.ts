// The app typecheck also reads this file (typed $fetch routes), so it needs the declaration too.
/// <reference path="../../openapi-document.d.ts" />
import document from '#openapi-document'

/** Public: the document describes the API and has no data. It is built at build time (nuxt.config.ts). */
export default defineEventHandler(() => new Response(document, {
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
}))
