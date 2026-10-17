import type { Config } from './config'
import type { Bindings } from './env'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>
}

const CAPTURE_KEY = Symbol.for('ticketing.capturedMail')

/** Messages sent by the `capture` transport. Tests run in the same isolate as the Worker. */
export function capturedMail(): MailMessage[] {
  const g = globalThis as Record<symbol, MailMessage[] | undefined>
  return (g[CAPTURE_KEY] ??= [])
}

export function createMailTransport(config: Config, env: Bindings): MailTransport {
  switch (config.mailTransport) {
    case 'cloudflare':
      return {
        async send(message) {
          await env.EMAIL!.send({ from: config.mailFrom!, to: message.to, subject: message.subject, text: message.text })
        },
      }
    case 'console':
      return {
        async send(message) {
          console.log(`\n--- email (console transport) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n---------------------------------\n`)
        },
      }
    case 'capture':
      return {
        async send(message) {
          capturedMail().push(message)
        },
      }
    case 'none':
      throw new Error('MAIL_TRANSPORT=none cannot send email.')
  }
}
