// This UI check supplements database permissions; it does not grant access.
// The legacy default preserves existing testing deployments.
export const PLATFORM_OWNER_EMAIL = (
  process.env.NEXT_PUBLIC_PLATFORM_OWNER_EMAIL || 'aruna@aidez.com.au'
).trim().toLowerCase()
