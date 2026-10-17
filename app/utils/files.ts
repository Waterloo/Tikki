/** 25 MB (7.4). The server refuses larger files; this check saves the upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
