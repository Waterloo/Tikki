import { getApplication } from '../../../utils/applications'
import { adminPrincipal, applicationNotFound, routeId } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const id = routeId(event, 'id')
  return (id !== null && await getApplication(db, id)) || applicationNotFound()
})
