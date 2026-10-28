import { supabase } from '@/lib/supabase'

// Navigation only. Each workspace and its RPCs still enforce their own access.
export async function workspaceDestination(client: typeof supabase = supabase): Promise<string> {
  const auth = await client.auth.getUser()
  if (!auth.data.user) return '/login'
  if (auth.error) throw auth.error
  const owner = await client.from('platform_admins').select('user_id').eq('user_id', auth.data.user.id).maybeSingle()
  if (owner.error) throw owner.error
  if (owner.data) return '/platform/dashboard'

  const partner = await client.rpc('partner_my_current_offer')
  if (partner.data) return partner.data.accepted ? '/partner/dashboard' : '/partner/accept'
  // A non-partner is expected to receive this explicit authorisation rejection.
  if (partner.error && !(partner.error.code === '42501' && partner.error.message.includes('NO_CURRENT_PARTNER_INVITATION'))) throw partner.error

  const invitation = await client.rpc('my_company_setup_invitation')
  if (invitation.error) throw invitation.error
  if (invitation.data?.length) return '/platform/company-setup'
  return '/dashboard'
}
