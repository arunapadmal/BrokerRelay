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

    const jwt = authHeader.slice(7)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
    const user = userData.user

    const body = await req.json().catch(() => ({}))
    const rawToken = typeof body.token === 'string' ? body.token.trim() : ''
    const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
    const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : ''
    const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : ''

    if (rawToken.length < 32 || rawToken.length > 256) return json({ error: 'INVALID_INVITATION' }, 400)
    if (!firstName || !lastName) return json({ error: 'FIRST_AND_LAST_NAME_REQUIRED' }, 400)
    if (!user.email) return json({ error: 'EMAIL_REQUIRED' }, 400)

    const tokenHash = await sha256Hex(rawToken)

    // Keep the signed-in user's profile aligned with onboarding details.
    const { error: profileError } = await userClient
      .from('profiles')
      .update({ first_name: firstName, last_name: lastName, mobile: mobile || null })
      .eq('id', user.id)

    if (profileError) return json({ error: 'PROFILE_UPDATE_FAILED' }, 500)

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: claimRows, error: claimError } = await admin.rpc('claim_client_invitation', {
      p_token_hash: tokenHash,
      p_user_id: user.id,
      p_email: user.email,
      p_first_name: firstName,
      p_last_name: lastName,
      p_mobile: mobile || null,
    })

    if (claimError) {
      const known = [
        'INVALID_INVITATION',
        'INVITATION_REVOKED',
        'INVITATION_EXPIRED',
        'INVITATION_ALREADY_CLAIMED',
        'BROKER_NOT_ACTIVE',
        'BROKER_PROFILE_NOT_ACTIVE',
        'CLIENT_ALREADY_ASSIGNED_TO_ANOTHER_PRIMARY_BROKER',
      ]
      const code = known.find((v) => claimError.message?.includes(v)) ?? 'INVITATION_CLAIM_FAILED'
      const status = code === 'INVALID_INVITATION' ? 404 : code.includes('EXPIRED') || code.includes('REVOKED') || code.includes('ALREADY') ? 409 : 400
      return json({ error: code }, status)
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows
    if (!claim) return json({ error: 'INVITATION_CLAIM_FAILED' }, 500)

    const [orgResult, brokerResult, brokerProfileResult] = await Promise.all([
      admin.from('organisations').select('name, logo_url, website').eq('id', claim.organisation_id).single(),
      admin.from('profiles').select('first_name, last_name, avatar_url').eq('id', claim.broker_user_id).single(),
      admin.from('broker_profiles').select('broker_code, title, contact_email, contact_mobile').eq('organisation_id', claim.organisation_id).eq('user_id', claim.broker_user_id).single(),
    ])

    await admin.from('audit_events').insert({
      organisation_id: claim.organisation_id,
      actor_user_id: user.id,
      event_type: 'client_invitation_claimed',
      entity_type: 'client',
      entity_id: claim.client_id,
      metadata: { invitation_id: claim.invitation_id, broker_user_id: claim.broker_user_id },
    })

    return json({
      client_id: claim.client_id,
      organisation: orgResult.data ?? null,
      broker: brokerResult.data && brokerProfileResult.data ? {
        ...brokerResult.data,
        ...brokerProfileResult.data,
      } : null,
    })
  } catch (_error) {
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
