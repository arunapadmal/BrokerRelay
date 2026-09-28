import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''

    if (!supabaseUrl || !anonKey || !serviceKey || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'UNAUTHENTICATED' }, 401)
    }

    const token = authHeader.slice(7)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
    const user = userData.user

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { body = {} }

    const requestedOrg = typeof body.organisation_id === 'string' ? body.organisation_id : null
    const requestedHours = typeof body.expires_in_hours === 'number' ? body.expires_in_hours : 72
    const expiresInHours = Math.max(1, Math.min(168, Math.floor(requestedHours)))

    let brokerQuery = userClient
      .from('broker_profiles')
      .select('organisation_id, broker_code, title')
      .eq('user_id', user.id)
      .eq('is_active', true)

    if (requestedOrg) brokerQuery = brokerQuery.eq('organisation_id', requestedOrg)

    const { data: brokerProfiles, error: brokerError } = await brokerQuery
    if (brokerError) return json({ error: 'BROKER_LOOKUP_FAILED' }, 500)
    if (!brokerProfiles || brokerProfiles.length === 0) return json({ error: 'ACTIVE_BROKER_PROFILE_REQUIRED' }, 403)
    if (!requestedOrg && brokerProfiles.length > 1) return json({ error: 'ORGANISATION_ID_REQUIRED' }, 400)

    const broker = brokerProfiles[0]
    const organisationId = broker.organisation_id

    const { data: membership, error: membershipError } = await userClient
      .from('organisation_memberships')
      .select('role, status')
      .eq('organisation_id', organisationId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('role', ['company_admin', 'broker'])
      .maybeSingle()

    if (membershipError) return json({ error: 'MEMBERSHIP_LOOKUP_FAILED' }, 500)
    if (!membership) return json({ error: 'BROKER_NOT_AUTHORISED' }, 403)

    const rawInviteToken = base64Url(crypto.getRandomValues(new Uint8Array(32)))
    const tokenHash = await sha256Hex(rawInviteToken)
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()

    const { data: invitation, error: inviteError } = await userClient
      .from('client_invitations')
      .insert({
        organisation_id: organisationId,
        broker_user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('id, expires_at, status')
      .single()

    if (inviteError || !invitation) {
      return json({ error: 'INVITATION_CREATE_FAILED' }, 500)
    }

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    await adminClient.from('audit_events').insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      event_type: 'client_invitation_created',
      entity_type: 'client_invitation',
      entity_id: invitation.id,
      metadata: { expires_at: invitation.expires_at },
    })

    return json({
      invitation_id: invitation.id,
      token: rawInviteToken,
      expires_at: invitation.expires_at,
      deep_link: `aidezconnect://join?token=${encodeURIComponent(rawInviteToken)}`,
      web_path: `/join/${encodeURIComponent(rawInviteToken)}`,
      broker_code: broker.broker_code,
    }, 201)
  } catch (_error) {
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
