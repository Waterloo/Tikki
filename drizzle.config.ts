import { defineConfig } from 'drizzle-kit'

// Migrations are forward-only. CI applies them with `wrangler d1 migrations apply`, never `drizzle-kit push`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './migrations',
})
