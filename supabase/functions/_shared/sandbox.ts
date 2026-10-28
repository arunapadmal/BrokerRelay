// This release only supports development authorisation testing.
// Keep invoice collection and the live payment worker outside this release.
export function assertSandboxEnvironment(env: (name: string) => string | undefined) {
  if (env('SUPABASE_URL') !== 'https://yhlaynvgmvfxvwhvlboq.supabase.co') throw new Error('DEVELOPMENT_PROJECT_REQUIRED')
  if (!env('STRIPE_SECRET_KEY')?.startsWith('sk_test_') || !env('STRIPE_PUBLISHABLE_KEY')?.startsWith('pk_test_')) throw new Error('STRIPE_TEST_KEYS_REQUIRED')
}
