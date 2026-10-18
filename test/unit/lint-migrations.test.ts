import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// The lint is a CLI, so the test runs it as one and reads its exit code and stderr.
function lint(dir: string) {
  const r = spawnSync('pnpm', ['exec', 'jiti', 'scripts/lint-migrations.ts', `test/fixtures/${dir}`], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

describe('lint-migrations', () => {
  it('passes a good set', () => {
    const r = lint('good-migrations')
    expect(r.code).toBe(0)
    expect(r.out).toContain('Migrations OK.')
  })

  it('reports each bad migration with file:line', () => {
    const r = lint('bad-migrations')
    const d = 'test/fixtures/bad-migrations'
    expect(r.code).toBe(1)
    expect(r.out).toContain(`${d}/0001_pragma.sql:1: PRAGMA foreign_keys`)
    expect(r.out).toContain(`${d}/0002_check.sql:4: \`__new_\` inside CHECK`)
    expect(r.out).toContain(`${d}/0003_insert.sql:6: SELECT names column \`missing_col\``)
    expect(r.out).toContain(`${d}/0004_unjournaled.sql:1: Not in meta/_journal.json.`)
  })
})
