import { z } from 'zod'
import { PRIORITIES } from '../db/schema'

export const ticketTextInput = z.object({
  title: z.string({ error: 'Must be text.' }).trim().min(1, 'Title is required.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string({ error: 'Must be text.' }).trim().max(20_000, 'Description must be 20000 characters or fewer.').default(''),
})

export const coreInput = ticketTextInput.extend({
  priority: z.enum(PRIORITIES, { error: 'Must be one of the options.' }).default('normal'),
})

export const typeInput = z.object({
  ticket_type_id: z.number({ error: 'Choose a Ticket Type.' }).int('Choose a Ticket Type.').positive('Choose a Ticket Type.'),
  fields: z.record(z.string(), z.unknown(), { error: 'Must be an object keyed by Field Key.' }).default({}),
})

/** The Contact a ticket from an Application is for. The same `external_id` always finds the same Contact (3.8). */
export const contactInput = z.object({
  external_id: z.string({ error: 'Must be text.' }).trim().min(1, 'The external ID is required.').max(200, 'Must be 200 characters or fewer.')
    .describe('Your ID for this person. The same ID always gives the same Contact.'),
  name: z.string({ error: 'Must be text.' }).trim().min(1, 'The name is required.').max(200, 'Must be 200 characters or fewer.'),
  email: z.email({ error: 'Must be an email address.' }).max(320, 'Must be 320 characters or fewer.'),
}, { error: 'Send the Contact: external_id, name, and email.' })

export const contactPart = z.object({ contact: contactInput })

/** The body of a create from an Application. Validation checks the same parts one by one, to report every problem at once. */
export const applicationTicketInput = coreInput.extend(typeInput.shape).extend(contactPart.shape)
