import type { H3Event } from 'h3'
import { adminPrincipal, apiError, applicationNotFound, routeId } from './rest'
import { db } from './services'
import { getApplicationEndpoint, type EndpointView } from './webhooks'

/** Admin check, then the Application and its one endpoint. Every `/applications/{id}/webhook` route starts here. */
export async function applicationWebhook(event: H3Event): Promise<{ applicationId: number, endpoint: EndpointView } | Response> {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  const applicationId = routeId(event, 'id')
  if (applicationId === null) return applicationNotFound()
  const endpoint = await getApplicationEndpoint(db, applicationId)
  return endpoint ? { applicationId, endpoint } : apiError(404, 'NOT_FOUND', 'This Application has no Webhook Endpoint.')
}
