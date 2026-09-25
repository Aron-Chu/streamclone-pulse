import { preflightMomentsReadiness } from './moments-readiness-preflight'

export default async function globalSetup(): Promise<void> {
  const portalURL = process.env.MOMENTS_READINESS_PORTAL_URL || 'http://127.0.0.1:5173'
  await preflightMomentsReadiness(portalURL)
}
