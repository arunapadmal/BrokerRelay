export function companySetupUrl() {
  if (typeof window !== 'undefined') return `${window.location.origin}/platform/company-setup`
  return `${(process.env.NEXT_PUBLIC_PORTAL_URL || 'https://brokerrelaydev.netlify.app').replace(/\/+$/, '')}/platform/company-setup`
}
