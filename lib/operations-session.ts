type ApiError = { message?: string; code?: string }
type OperationsClient = {
  rpc: (name: string) => PromiseLike<{data: any; error: ApiError | null}>
  auth: { refreshSession: () => PromiseLike<{data: {session: unknown}; error: ApiError | null}> }
}
export function tokenTimingError(error: unknown): boolean {
  const message = (error as ApiError)?.message ?? ''
  return /JWT.*(?:issued at future|not yet valid|expired)|token.*(?:not yet valid|expired)/i.test(message)
}
export async function loadOperations(client: OperationsClient) {
  let result = await client.rpc('platform_operations')
  if (result.error && tokenTimingError(result.error)) {
    const refreshed = await client.auth.refreshSession()
    if (refreshed.error) throw refreshed.error
    if (!refreshed.data.session) throw {code:'SESSION_REQUIRED',message:'Sign in to your account again.'}
    result = await client.rpc('platform_operations')
  }
  if (result.error) throw result.error
  return result.data
}
export function operationsErrorMessage(error: unknown): string {
  const e = error as ApiError
  if (tokenTimingError(e)) return 'Your session token could not be verified because of a timing mismatch. Sign out and sign in again. If it continues, report: '+e.message
  if (e?.code === 'PGRST202' || e?.code === '42883') return 'The Operations database function is unavailable. Apply the matching Operations SQL update for this environment.'
  if (e?.code === '42501') return 'Operations is restricted to the Platform Owner. Sign in with the platform-owner account.'
  if (e?.code === 'SESSION_REQUIRED' || /refresh token|session.*(?:missing|expired|not found)/i.test(e?.message??'')) return 'Your session has expired. Please sign in again.'
  return e?.message || 'Operations could not be checked. Try Refresh checks again.'
}
