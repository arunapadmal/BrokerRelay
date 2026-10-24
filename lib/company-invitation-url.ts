// Configure each deployment independently to avoid sending live users to testing.
const portalUrl = (
  process.env.NEXT_PUBLIC_PORTAL_URL || 'https://brokerrelay.netlify.app'
).replace(/\/+$/, '')

export const COMPANY_SETUP_URL = `${portalUrl}/platform/company-setup`
