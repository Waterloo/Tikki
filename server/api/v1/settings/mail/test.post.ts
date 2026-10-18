import { config } from '../../../../utils/env'
import { recordMailResult } from '../../../../utils/notice-mail'
import { apiError, adminPrincipal } from '../../../../utils/rest'
import { eq } from 'drizzle-orm'
import { user } from '../../../../db/schema'
import { db, useMail } from '../../../../utils/services'

/** Sends a test email to the Admin who asks. The answer is the transport's own result, so a limit or a bad sender shows at once. */
export default defineEventHandler(async (event) => {
  const principal = await adminPrincipal(event)
  if (principal instanceof Response) return principal
  if (config.mailTransport === 'none') return apiError(409, 'MAIL_DISABLED', 'The mail transport is "none". No email is sent.')
  const [{ email: to }] = await db.select({ email: user.email }).from(user).where(eq(user.id, principal.userId)) as [{ email: string }]
  try {
    await useMail().send({
      to,
      subject: 'Test email',
      text: 'This is a test email from your ticketing system. Notification emails are sent from this address.',
      html: '<p>This is a test email from your ticketing system. Notification emails are sent from this address.</p>',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Test email failed', message)
    await recordMailResult(db, message)
    return apiError(502, 'MAIL_SEND_FAILED', `The mail transport refused the email: ${message}`)
  }
  await recordMailResult(db, null)
  return { sent_to: to }
})
