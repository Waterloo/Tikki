/// <reference path="../../ticket-apps-guide.d.ts" />
import guide from '#ticket-apps-guide'

/** The developer guide, so the admin page can link to it on every instance. */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return guide
})
