/** The old address of the guide. The admin page linked here before the docs site existed. */
export default defineEventHandler(event => sendRedirect(event, '/docs/ticket-apps.md', 301))
