import { listTeams } from '../../../utils/people'
import { peopleError, peoplePrincipal } from '../../../utils/rest'
import { db } from '../../../utils/services'

export default defineEventHandler(async (event) => {
  const principal = await peoplePrincipal(event)
  if (principal instanceof Response) return principal
  try {
    return { data: await listTeams(db, principal) }
  } catch (error) {
    return peopleError(error)
  }
})
