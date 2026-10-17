/// <reference types="@cloudflare/workers-types" />
import { env as workerEnv } from 'cloudflare:workers'
import { readConfig } from './config'

export interface Bindings {
  DB: D1Database
  FILES: R2Bucket
  EMAIL?: SendEmail
  [name: string]: unknown
}

export const env = workerEnv as unknown as Bindings

// Evaluated when the Worker starts (see server/plugins/config.ts), so a bad configuration fails the deploy.
export const config = readConfig(env)
