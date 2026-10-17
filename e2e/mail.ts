import { readFileSync, statSync } from 'node:fs'
import { expect } from '@playwright/test'

// The `console` mail transport prints each email to the server output. playwright.config.ts
// sends that output to this file.
const LOG = new URL('./.server.log', import.meta.url)

export function logSize(): number {
  return statSync(LOG).size
}

/** The newest sign-in code sent to `email` after log offset `from`. Fails if none arrives. */
export async function readCode(email: string, from: number): Promise<string> {
  let code: string | undefined
  await expect(async () => {
    const text = readFileSync(LOG).subarray(from).toString('utf8')
    const matches = [...text.matchAll(/To: (\S+)\n[\s\S]*?Your sign-in code is (\d{6})/g)]
    code = matches.filter(m => m[1] === email).at(-1)?.[2]
    expect(code, `no sign-in code for ${email} in the server log`).toBeTruthy()
  }).toPass({ timeout: 15_000 })
  return code!
}
