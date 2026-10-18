/**
 * Data-keeping test for migrations. Run: `pnpm test`, or `pnpm exec nuxt build` first and then `pnpm vitest run test/worker/migrations.test.ts`. The worker tests run the built `.output`.
 *
 * The worker project applies all migrations in a setup file, so env.DB is already migrated. This test first
 * drops every table, then applies the migrations one at a time with `applyD1Migrations` (one migration is one
 * atomic batch, as on D1). Before each migration it makes sure every table that exists has a valid row. After
 * each migration it asserts:
 *   - `PRAGMA foreign_key_check` is empty,
 *   - no table lost rows (a table may vanish only if the migration has `DROP TABLE` for it),
 *   - `sqlite_sequence` values did not go down.
 * This catches a rebuild that drops rows or the AUTOINCREMENT counter, or leaves dangling references.
 *
 * Usage notes
 *   - Rows come from `PRAGMA table_info` / `foreign_key_list`: NOT NULL columns get a unique value, foreign keys
 *     point at an existing parent row, nullable foreign keys stay NULL.
 *   - A CHECK that this cannot satisfy fails the test with the SQLite message. Add the table to OVERRIDES.
 *   - A new table needs no change here unless it has such a CHECK.
 */
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

interface Col { name: string, type: string, notnull: number, dflt_value: string | null, pk: number, hidden: number }
interface Fk { table: string, from: string, to: string | null }

// '@fk' = point at a parent row even though the column is nullable. null = force NULL.
// Needed for "exactly one of two columns" CHECKs.
const OVERRIDES: Record<string, Record<string, string | null>> = {
  ticket: { requester_id: '@fk', contact_id: null },
  comment: { author_id: '@fk', application_id: null },
  attachment: { uploader_id: '@fk', application_id: null },
  audit_log: { principal_id: '@fk', application_id: null, ticket_number: '@fk', subject_type: null, subject_id: null },
  webhook_endpoint: { owner: 'admin', application_id: null },
  ticket_app: { sidebar_url: 'https://app.example.com/' },
}

const db = env.DB
const q = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results
const quote = (id: string) => `"${id.replace(/"/g, '""')}"`

async function userTables() {
  const rows = await q<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`)
  return rows.map(r => r.name)
}

/** Children first: dropping a parent before its children fails with "no such table". */
async function dropEverything() {
  const refs = new Map<string, Set<string>>()
  for (const t of await userTables()) {
    const parents = await q<Fk>(`PRAGMA foreign_key_list(${quote(t)})`)
    refs.set(t, new Set(parents.map(p => p.table).filter(p => p !== t)))
  }
  const order: string[] = []
  while (refs.size) {
    const leaves = [...refs.keys()].filter(t => ![...refs.entries()].some(([o, ps]) => o !== t && ps.has(t)))
    if (!leaves.length) throw new Error(`Foreign key cycle: ${[...refs.keys()].join(', ')}`)
    for (const t of leaves) { order.push(t); refs.delete(t) }
  }
  await db.batch([...order.map(t => db.prepare(`DROP TABLE ${quote(t)}`)), db.prepare('DROP TABLE IF EXISTS d1_migrations')])
}

async function counts() {
  const out: Record<string, number> = {}
  for (const t of await userTables()) out[t] = (await q<{ n: number }>(`SELECT count(*) AS n FROM ${quote(t)}`))[0]!.n
  return out
}

async function sequences() {
  const rows = await q<{ name: string, seq: number }>('SELECT name, seq FROM sqlite_sequence')
  return Object.fromEntries(rows.map(r => [r.name, r.seq]))
}

let counter = 1000

/**
 * Insert one row into an empty table. Returns false when the table cannot get a row yet (a parent is empty).
 * Tables that have rows are skipped: foreign keys always use the first parent row, so a second row could break a
 * UNIQUE index over foreign key columns.
 */
async function insertRow(table: string): Promise<boolean> {
  if ((await q<{ n: number }>(`SELECT count(*) AS n FROM ${quote(table)}`))[0]!.n) return true
  const cols = await q<Col>(`PRAGMA table_xinfo(${quote(table)})`)
  const fks = await q<Fk>(`PRAGMA foreign_key_list(${quote(table)})`)
  const over = OVERRIDES[table] ?? {}
  const names: string[] = []
  const values: unknown[] = []
  const n = ++counter

  for (const c of cols) {
    if (c.hidden) continue // generated column
    const fk = fks.find(f => f.from === c.name)
    let v: unknown
    if (c.name in over && over[c.name] !== '@fk') {
      v = over[c.name]
    } else if (fk && (c.notnull || over[c.name] === '@fk')) {
      const parentCol = fk.to ?? (await q<Col>(`PRAGMA table_info(${quote(fk.table)})`)).find(p => p.pk)!.name
      const parent = await q<Record<string, unknown>>(`SELECT ${quote(parentCol)} AS v FROM ${quote(fk.table)} LIMIT 1`)
      if (!parent.length) return false
      v = parent[0]!.v
    } else if (fk) {
      continue // nullable foreign key: leave NULL
    } else if (c.dflt_value !== null) {
      continue
    } else if (c.pk && /^int/i.test(c.type) && c.pk === 1) {
      continue // rowid alias
    } else if (!c.notnull && !c.pk) {
      continue
    } else if (/int|real|num|bool/i.test(c.type)) {
      v = n
    } else {
      v = `${table}.${c.name}.${n}`
    }
    names.push(quote(c.name))
    values.push(v)
  }

  const sql = names.length
    ? `INSERT INTO ${quote(table)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
    : `INSERT INTO ${quote(table)} DEFAULT VALUES`
  try {
    await db.prepare(sql).bind(...values).run()
  } catch (e) {
    throw new Error(`Cannot insert a generic row into ${table}: ${(e as Error).message}. Add it to OVERRIDES.`, { cause: e })
  }
  return true
}

/** Parents first. Rows for a table whose parent is still empty are retried after the others. */
async function seedAllTables() {
  let pending = await userTables()
  while (pending.length) {
    const next: string[] = []
    for (const t of pending) if (!(await insertRow(t))) next.push(t)
    if (next.length === pending.length) throw new Error(`Cannot seed (foreign key cycle?): ${next.join(', ')}`)
    pending = next
  }
}

describe('migrations keep data', () => {
  it('applies one by one over seeded rows', async () => {
    const migrations = env.TEST_MIGRATIONS
    await dropEverything()
    const dropped = (m: { queries: string[] }, t: string) =>
      m.queries.join('\n').match(new RegExp('DROP TABLE\\s+(IF EXISTS\\s+)?[`"]?' + t + '[`"]?(?![\\w])', 'i')) !== null

    let seeded: string[] = []
    for (const m of migrations) {
      await seedAllTables()
      const beforeCounts = await counts()
      seeded = Object.keys(beforeCounts)
      const beforeSeq = await sequences()

      await applyD1Migrations(db, [m])

      const afterCounts = await counts()
      const afterSeq = await sequences()
      const where = `after ${m.name}`

      expect(await q('PRAGMA foreign_key_check'), `foreign_key_check ${where}`).toEqual([])
      for (const [t, n] of Object.entries(beforeCounts)) {
        if (!(t in afterCounts)) {
          expect(dropped(m, t), `table ${t} vanished ${where} without DROP TABLE`).toBe(true)
          continue
        }
        expect(afterCounts[t], `rows of ${t} ${where}`).toBeGreaterThanOrEqual(n)
      }
      for (const [t, seq] of Object.entries(beforeSeq)) {
        if (!(t in afterCounts)) continue
        expect(afterSeq[t] ?? 0, `sqlite_sequence of ${t} ${where}`).toBeGreaterThanOrEqual(seq)
      }
    }

    // Guards against a seeding bug that makes the checks above pass on empty tables. A table that the last migration
    // made was never seeded, so it is left out.
    const final = await counts()
    expect(seeded.filter(t => final[t] === 0), 'tables without rows at the end').toEqual([])
  }, 60_000)

  it('issue 37: maps each app\'s url to the column of its position, and keeps the ids and the counter', async () => {
    const migrations = env.TEST_MIGRATIONS
    const at = migrations.findIndex(m => m.name.includes('issue_37_ticket_app_placements'))
    expect(at).toBeGreaterThan(0)
    await dropEverything()
    await applyD1Migrations(db, migrations.slice(0, at))
    const insert = 'INSERT INTO ticket_app (id, name, url, position, ticket_type_ids, sort_order, enabled, created_at, access) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    await db.batch([
      db.prepare(insert).bind(1, 'Orders', 'https://orders.example.com/card', 'sidebar', null, 1, 1, 1000, 'comment'),
      db.prepare(insert).bind(2, 'Orders', 'https://orders.example.com/tab', 'tab', '[3]', 2, 0, 2000, 'read'),
      db.prepare(insert).bind(5, 'Gone', 'https://gone.example.com/', 'sidebar', null, 3, 1, 3000, 'read'),
      db.prepare('DELETE FROM ticket_app WHERE id = 5'),
    ])
    await applyD1Migrations(db, migrations.slice(at))
    // Two apps that differ only in position stay two apps.
    expect(await q('SELECT id, name, sidebar_url, tab_url, page_url, ticket_type_ids, sort_order, enabled, created_at, access FROM ticket_app ORDER BY id')).toEqual([
      { id: 1, name: 'Orders', sidebar_url: 'https://orders.example.com/card', tab_url: null, page_url: null, ticket_type_ids: null, sort_order: 1, enabled: 1, created_at: 1000, access: 'comment' },
      { id: 2, name: 'Orders', sidebar_url: null, tab_url: 'https://orders.example.com/tab', page_url: null, ticket_type_ids: '[3]', sort_order: 2, enabled: 0, created_at: 2000, access: 'read' },
    ])
    expect((await sequences()).ticket_app).toBe(5)
    await expect(db.prepare('INSERT INTO ticket_app (name, sort_order, created_at) VALUES (\'No URL\', 9, 0)').run()).rejects.toThrow(/CHECK/)
  })
})
