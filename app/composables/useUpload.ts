import type { Attachment } from '~/types/tickets'

export class UploadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/**
 * Uploads one file as a raw body. Without `ticketRef` it is an upload before the ticket exists (New ticket form).
 * Throws UploadError with a message a person can read.
 */
export async function uploadFile(file: File, ticketRef?: string): Promise<Attachment> {
  if (file.size === 0) throw new UploadError('This file is empty.')
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('The file must be 25 MB or smaller.')
  try {
    return await $fetch<Attachment>(ticketRef ? `/api/v1/tickets/${encodeURIComponent(ticketRef)}/attachments` : '/api/v1/attachments', {
      method: 'PUT',
      body: file,
      headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
    })
  } catch (e) {
    const err = e as { status?: number, data?: { error?: { message?: string } } }
    if (err.status === 401) await navigateTo('/sign-in')
    throw new UploadError(err.data?.error?.message ?? 'The file could not be uploaded. Check your connection, then try again.', err.status)
  }
}
