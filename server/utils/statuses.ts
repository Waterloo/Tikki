import { asc } from 'drizzle-orm'
import { status, type StatusCategory } from '../db/schema'
import type { Db } from './auth'

export interface StatusView {
  key: string
  name: string
  category: StatusCategory
}

/** Every Status, in workflow order. */
export async function listStatuses(db: Db): Promise<StatusView[]> {
  return db.select({ key: status.key, name: status.name, category: status.category }).from(status).orderBy(asc(status.position))
}
