import type { Config } from './config'
import type { Bindings } from './env'

export interface MailMessage {
  to: string
  subject: string
  text: string
  /** Optional. Every value in it must be escaped by the caller. */
  html?: string
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

const FAIL_KEY = Symbol.for('ticketing.captureFailure')

/** Makes the `capture` transport throw this message (or work again with null). For tests of transport errors. */
export function failCapturedMail(message: string | null) {
  (globalThis as Record<symbol, string | null>)[FAIL_KEY] = message
}

export function createMailTransport(config: Config, env: Bindings): MailTransport {
  switch (config.mailTransport) {
    case 'cloudflare':
      return {
        async send(message) {
          await env.EMAIL!.send({ from: config.mailFrom!, to: message.to, subject: message.subject, text: message.text, ...(message.html && { html: message.html }) })
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
          const failure = (globalThis as Record<symbol, string | null | undefined>)[FAIL_KEY]
          if (failure) throw new Error(failure)
          capturedMail().push(message)
        },
      }
    case 'none':
      throw new Error('MAIL_TRANSPORT=none cannot send email.')
  }
}
