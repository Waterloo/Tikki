/**
 * Lint for D1 migrations. Run: `pnpm lint:migrations` (also part of `pnpm test` and CI).
 *
 * drizzle-kit writes SQLite table rebuilds that are wrong for D1. This lint fails on:
 *   1. `PRAGMA foreign_keys` (any value). D1 ignores it. Use `PRAGMA defer_foreign_keys = on`, copy the rows
 *      aside, drop, recreate under the original name, insert back (see 0018).
 *   2. `__new_` inside a CHECK (...). drizzle-kit prefixes column names; the prefix breaks after the rename.
 *   3. `INSERT INTO ... SELECT` that names a column the source table does not have at that point. The migrations
 *      are replayed in order into an in-memory SQLite to know each table's columns.
 *   4. A mismatch between `migrations/*.sql` and `migrations/meta/_journal.json`.
 *
 * Output is `file:line: message`. Exit code 1 on any finding.
 *
 * Usage notes
 *   pnpm lint:migrations              lint ./migrations
 *   pnpm lint:migrations <dir>        lint another directory (used to try a bad sample)
 * Needs Node 22+ (`node:sqlite`).
 * Migrations that are already applied are never edited, so GRANDFATHERED lists the known old findings.
 * Do not add new entries: fix the SQL instead.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

interface Finding { file: string, line: number, message: string }
interface Stmt { sql: string, line: number }

// 0013 has the drizzle-kit PRAGMA lines. They are no-ops on D1 and the file is already applied.
const GRANDFATHERED: Record<string, RegExp> = {
  '0013_admin_audit.sql': /PRAGMA foreign_keys/,
}

const findings: Finding[] = []

/** Blank out comments but keep offsets, so line numbers stay right. Quoted text is kept. */
function stripComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length;) {
    const c = src[i]!
    if (c === '\'' || c === '"' || c === '`') {
      let j = src.indexOf(c, i + 1)
      if (j < 0) j = src.length - 1
      out += src.slice(i, j + 1)
      i = j + 1
    } else if (c === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

const MARK = '--> statement-breakpoint'

/** Split on drizzle's breakpoint marker. The marker is a comment, so split the raw text. */
function splitStatements(raw: string): Stmt[] {
  const stmts: Stmt[] = []
  let offset = 0
  for (const part of raw.split(/-->\s*statement-breakpoint/)) {
    const clean = stripComments(part)
    const lead = clean.length - clean.trimStart().length
    if (clean.trim()) {
      const line = raw.slice(0, offset + lead).split('\n').length
      stmts.push({ sql: clean.trim().replace(/;$/, ''), line })
    }
    offset += part.length + MARK.length
  }
  return stmts
}

/** Index of the paren that closes the one opened at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]!
    if (c === '\'' || c === '"' || c === '`') { i = s.indexOf(c, i + 1); if (i < 0) break; continue }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '\'' || c === '"' || c === '`') { i = s.indexOf(c, i + 1); if (i < 0) break; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1 }
  }
  parts.push(s.slice(start))
  return parts.map(p => p.trim())
}

const unquote = (id: string) => id.replace(/^[`"[]|[`"\]]$/g, '')

function columnsOf(db: DatabaseSync, table: string): Set<string> | null {
  const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as { name: string }[]
  return rows.length ? new Set(rows.map(r => r.name.toLowerCase())) : null
}

function lintStatement(file: string, st: Stmt, db: DatabaseSync) {
  const skip = GRANDFATHERED[basename(file)]
  const add = (message: string, at = 0) => {
    if (skip?.test(message)) return
    findings.push({ file, line: st.line + st.sql.slice(0, at).split('\n').length - 1, message })
  }

  for (const m of st.sql.matchAll(/\bPRAGMA\s+foreign_keys\b/gi)) {
    add('PRAGMA foreign_keys is ignored by D1. Use `PRAGMA defer_foreign_keys = on` and copy the rows aside (see 0018).', m.index)
  }

  for (const m of st.sql.matchAll(/\bCHECK\s*\(/gi)) {
    const open = m.index + m[0].length - 1
    const close = matchParen(st.sql, open)
    const body = st.sql.slice(open, close < 0 ? undefined : close + 1)
    const bad = body.indexOf('__new_')
    if (bad >= 0) add('`__new_` inside CHECK. Remove the prefix; it breaks after the table is renamed.', open + bad)
  }

  const ins = /^INSERT\s+INTO\s+\S+\s*(?:\([^)]*\))?\s*SELECT\s+([\s\S]*?)\s+FROM\s+([`"\w]+)/i.exec(st.sql)
  if (ins) {
    const list = ins[1]!
    const src = unquote(ins[2]!)
    const cols = columnsOf(db, src)
    if (!cols) {
      add(`INSERT ... SELECT reads from \`${src}\`, which does not exist at this point.`)
    } else {
      for (const item of splitTopLevel(list)) {
        const code = item.replace(/'(?:[^']|'')*'/g, m => ' '.repeat(m.length))
        for (const id of code.matchAll(/"([^"]+)"|`([^`]+)`/g)) {
          const name = (id[1] ?? id[2])!
          if (!cols.has(name.toLowerCase())) {
            add(`SELECT names column \`${name}\`, but \`${src}\` has no such column here. Use NULL or a default for new columns.`)
          }
        }
      }
    }
  }
}

function lint(dir: string) {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: false })

  for (const f of files) {
    const rel = join(dir, f)
    for (const st of splitStatements(readFileSync(rel, 'utf8'))) {
      lintStatement(rel, st, db)
      try {
        db.exec(st.sql)
      } catch (e) {
        findings.push({ file: rel, line: st.line, message: `SQL does not run: ${(e as Error).message}` })
      }
    }
  }

  const journalPath = join(dir, 'meta', '_journal.json')
  if (!existsSync(journalPath)) return
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const tags = journal.entries.map(e => e.tag)
  const names = files.map(f => f.replace(/\.sql$/, ''))
  for (const n of names) {
    if (!tags.includes(n)) findings.push({ file: join(dir, `${n}.sql`), line: 1, message: 'Not in meta/_journal.json.' })
  }
  for (const t of tags) {
    if (!names.includes(t)) findings.push({ file: journalPath, line: 1, message: `Journal tag \`${t}\` has no SQL file.` })
  }
  if (!findings.length && names.join() !== tags.join()) {
    findings.push({ file: journalPath, line: 1, message: 'Journal order differs from the SQL file order.' })
  }
}

lint(resolve(process.argv[2] ?? 'migrations'))

if (findings.length) {
  for (const f of findings) console.error(`${f.file}:${f.line}: ${f.message}`)
  console.error(`\n${findings.length} migration problem(s).`)
  process.exit(1)
}
console.log('Migrations OK.')
