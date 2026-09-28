import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const allowedRoles = new Set([
  'head_broker', 'broker', 'administrator', 'accounts', 'hr', 'broker_assistant',
])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!url || !anonKey || !serviceKey || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'UNAUTHENTICATED' }, 401)
    }

    const token = authHeader.slice(7)
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const publicClient = createClient(url, anonKey, { auth: { persistSession: false } })
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await authClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? 'invite')
    if (action === 'resend') {
      const invitationId = String(body.invitation_id ?? '')
      const { data: invitation, error } = await admin.rpc('service_resend_staff_invitation', {
        p_actor_user_id: userData.user.id, p_invitation_id: invitationId,
      })
      if (error) return json({ error: 'INVITATION_RESEND_FAILED', detail: error.message }, 400)
      const redirectTo = Deno.env.get('BROKERDESK_INVITE_REDIRECT_URL') || 'http://localhost:3000/staff/accept'
      const { error: linkError } = await publicClient.auth.signInWithOtp({
        email: invitation.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
      if (linkError) return json({ error: 'AUTH_INVITATION_FAILED', detail: linkError.message }, 502)
      return json({ invitation_id: invitationId, email_sent: true })
    }
    if (action !== 'invite') return json({ error: 'INVALID_ACTION' }, 400)
    const organisationId = String(body.organisation_id ?? '')
    const email = String(body.email ?? '').trim().toLowerCase()
    const firstName = String(body.first_name ?? '').trim()
    const lastName = String(body.last_name ?? '').trim()
    const brokerCode = String(body.broker_code ?? '').trim() || null
    const title = String(body.title ?? '').trim() || null
    const roles = Array.isArray(body.roles)
      ? [...new Set(body.roles.map(String).filter((role) => allowedRoles.has(role)))]
      : []

    if (!organisationId || !email || !email.includes('@') || !firstName || !lastName || roles.length === 0) {
      return json({ error: 'INVALID_INVITATION_DETAILS' }, 400)
    }

    // First authorization check uses the caller's JWT and the same database
    // policy that powers the administration screen.
    const { error: accessError } = await authClient.rpc('admin_get_company_snapshot', {
      p_organisation_id: organisationId,
    })
    if (accessError) return json({ error: 'STAFF_MANAGEMENT_NOT_AUTHORISED' }, 403)

    let userId: string | null = null
    const { data: existingId, error: lookupError } = await admin.rpc('service_find_user_by_email', {
      p_email: email,
    })
    if (lookupError) return json({ error: 'USER_LOOKUP_FAILED' }, 500)
    userId = existingId as string | null

    const { data: inviteState, error: preflightError } = await admin.rpc('service_staff_invite_preflight', {
      p_actor_user_id: userData.user.id, p_organisation_id: organisationId,
      p_user_id: userId, p_email: email,
    })
    if (preflightError) return json({ error: 'INVITATION_PREFLIGHT_FAILED', detail: preflightError.message }, 400)
    if (inviteState === 'pending') return json({ error: 'INVITATION_ALREADY_PENDING_USE_RESEND' }, 409)
    if (inviteState === 'active') return json({ error: 'STAFF_ALREADY_ACTIVE' }, 409)
    if (inviteState === 'disabled') return json({ error: 'STAFF_DISABLED_USE_REACTIVATE' }, 409)

    let emailSent = false
    const createdAuthUser = !userId
    if (!userId) {
      const redirectTo = Deno.env.get('BROKERDESK_INVITE_REDIRECT_URL') || 'http://localhost:3000/staff/accept'
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { first_name: firstName, last_name: lastName },
        redirectTo,
      })
      if (inviteError || !invited.user) {
        return json({ error: 'AUTH_INVITATION_FAILED', detail: inviteError?.message }, 502)
      }
      userId = invited.user.id
      emailSent = true
    } else {
      await admin.from('profiles').update({ first_name: firstName, last_name: lastName }).eq('id', userId)
      const redirectTo = Deno.env.get('BROKERDESK_INVITE_REDIRECT_URL') || 'http://localhost:3000/staff/accept'
      const { error: linkError } = await publicClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
      if (linkError) return json({ error: 'AUTH_INVITATION_FAILED', detail: linkError.message }, 502)
      emailSent = true
    }

    const { data: invitationId, error: membershipError } = await admin.rpc('service_create_staff_invitation_v2', {
      p_actor_user_id: userData.user.id,
      p_organisation_id: organisationId,
      p_user_id: userId,
      p_email: email,
      p_first_name: firstName,
      p_last_name: lastName,
      p_roles: roles,
      p_broker_code: brokerCode,
      p_title: title,
      p_requires_password_setup: createdAuthUser,
    })
    if (membershipError) {
      return json({ error: 'MEMBERSHIP_CREATE_FAILED', detail: membershipError.message }, 400)
    }

    return json({ invitation_id: invitationId, user_id: userId, email_sent: emailSent }, 201)
  } catch (_error) {
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
