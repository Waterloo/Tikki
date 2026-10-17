import { db } from '../../../utils/services'
import { getOrganization } from '../../../utils/settings'

// Public: the sign-in page shows the name, subtitle and logo before anyone is signed in.
export default defineEventHandler(async () => getOrganization(db))
