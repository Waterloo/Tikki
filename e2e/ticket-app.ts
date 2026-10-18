import { expect, type Frame, type Page } from '@playwright/test'

/** Same as playwright.config.ts. */
export const TIKKI_ORIGIN = `http://localhost:${Number(process.env.E2E_PORT ?? 8799)}`
/** The test Ticket App runs on another port, so on another origin (e2e/ticket-app-server.mjs). */
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? Number(process.env.E2E_PORT ?? 8799) + 100)
export const APP_ORIGIN = `http://localhost:${APP_PORT}`

/** The test app URL. `mode`: `normal` asks for the context, `silent` never answers, `writer` also has an "Add note" button. */
export function appUrl(tikkiOrigin: string, mode: 'normal' | 'silent' | 'writer' = 'normal', extra = '') {
  return `${APP_ORIGIN}/app.html?tikki=${encodeURIComponent(tikkiOrigin)}&mode=${mode}${extra}`
}

export interface ContextMessage { ref: string, theme: string, token: string, expires_at: string, data: Record<string, any> }

/** The frame of the app with this name (and placement, for an app with two), once the app got its first context. */
export async function appFrame(page: Page, name: string, placement?: 'sidebar' | 'tab' | 'page'): Promise<Frame> {
  const handle = await page.locator(`iframe[title="${name}"]${placement ? `[data-placement="${placement}"]` : ''}`).elementHandle()
  const frame = await handle!.contentFrame()
  await expect.poll(async () => (await contexts(frame!)).length).toBeGreaterThan(0)
  return frame!
}

export function contexts(frame: Frame): Promise<ContextMessage[]> {
  return frame.evaluate(() => (window as unknown as { tikkiLog?: ContextMessage[] }).tikkiLog ?? [])
}
