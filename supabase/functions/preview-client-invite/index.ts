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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) return json({ error: 'SERVER_CONFIGURATION_ERROR' }, 500)

    const body = await req.json().catch(() => ({}))
    const rawToken = typeof body.token === 'string' ? body.token.trim() : ''
    if (rawToken.length < 32 || rawToken.length > 256) return json({ error: 'INVALID_INVITATION' }, 400)

    const tokenHash = await sha256Hex(rawToken)
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: invitation, error: inviteError } = await admin
      .from('client_invitations')
      .select('id, organisation_id, broker_user_id, status, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (inviteError) return json({ error: 'LOOKUP_FAILED' }, 500)
    if (!invitation) return json({ error: 'INVALID_INVITATION' }, 404)

    if (invitation.status !== 'pending') {
      return json({ error: invitation.status === 'claimed' ? 'INVITATION_ALREADY_CLAIMED' : 'INVITATION_NOT_ACTIVE' }, 410)
    }

    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await admin.from('client_invitations').update({ status: 'expired' }).eq('id', invitation.id).eq('status', 'pending')
      return json({ error: 'INVITATION_EXPIRED' }, 410)
    }

    const [orgResult, brokerResult, profileResult] = await Promise.all([
      admin.from('organisations').select('name, logo_url, website').eq('id', invitation.organisation_id).single(),
      admin.from('broker_profiles').select('broker_code, title, contact_email, contact_mobile, is_active').eq('organisation_id', invitation.organisation_id).eq('user_id', invitation.broker_user_id).single(),
      admin.from('profiles').select('first_name, last_name, avatar_url').eq('id', invitation.broker_user_id).single(),
    ])

    if (orgResult.error || brokerResult.error || profileResult.error || !brokerResult.data?.is_active) {
      return json({ error: 'INVITATION_NOT_AVAILABLE' }, 410)
    }

    return json({
      invitation_id: invitation.id,
      expires_at: invitation.expires_at,
      organisation: orgResult.data,
      broker: {
        ...profileResult.data,
        broker_code: brokerResult.data.broker_code,
        title: brokerResult.data.title,
        contact_email: brokerResult.data.contact_email,
        contact_mobile: brokerResult.data.contact_mobile,
      },
    })
  } catch (_error) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
})
