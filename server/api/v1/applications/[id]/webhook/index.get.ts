import { getApplication } from '../../../../../utils/applications'
import { adminPrincipal, applicationNotFound, routeId } from '../../../../../utils/rest'
import { db } from '../../../../../utils/services'
import { getApplicationEndpoint } from '../../../../../utils/webhooks'

/** `{ data }`: the Application's endpoint, or `null` when it has none. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  if (id === null || !await getApplication(db, id)) return applicationNotFound()
  return { data: await getApplicationEndpoint(db, id) }
})
