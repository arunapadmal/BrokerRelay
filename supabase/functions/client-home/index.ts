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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const authHeader = req.headers.get('Authorization') ?? ''

    if (!supabaseUrl || !anonKey || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'UNAUTHENTICATED' }, 401)
    }

    const jwt = authHeader.slice(7)
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userData, error: userError } = await client.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
    const user = userData.user

    const { data: clientRows, error: clientError } = await client
      .from('clients')
      .select('id, organisation_id, first_name, last_name, email, mobile, status, connected_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('connected_at', { ascending: false })
      .limit(1)

    if (clientError) return json({ error: 'CLIENT_LOOKUP_FAILED' }, 500)
    if (!clientRows || clientRows.length === 0) return json({ error: 'CLIENT_CONNECTION_REQUIRED' }, 404)

    const clientRow = clientRows[0]

    const { data: assignment, error: assignmentError } = await client
      .from('client_assignments')
      .select('member_user_id, assignment_role')
      .eq('organisation_id', clientRow.organisation_id)
      .eq('client_id', clientRow.id)
      .eq('assignment_role', 'primary_broker')
      .maybeSingle()

    if (assignmentError) return json({ error: 'ASSIGNMENT_LOOKUP_FAILED' }, 500)
    if (!assignment) return json({ error: 'PRIMARY_BROKER_REQUIRED' }, 404)

    const [orgResult, brokerProfileResult, brokerUserResult] = await Promise.all([
      client.from('organisations').select('name, legal_name, website, logo_url, contact_phone').eq('id', clientRow.organisation_id).single(),
      client.from('broker_profiles').select('broker_code, title, contact_email, contact_mobile').eq('organisation_id', clientRow.organisation_id).eq('user_id', assignment.member_user_id).single(),
      client.from('profiles').select('first_name, last_name, avatar_url').eq('id', assignment.member_user_id).single(),
    ])

    if (orgResult.error) return json({ error: 'ORGANISATION_LOOKUP_FAILED' }, 500)
    if (brokerProfileResult.error || brokerUserResult.error) return json({ error: 'BROKER_LOOKUP_FAILED' }, 500)

    return json({
      client: {
        id: clientRow.id,
        first_name: clientRow.first_name,
        last_name: clientRow.last_name,
        email: clientRow.email,
        mobile: clientRow.mobile,
        status: clientRow.status,
        connected_at: clientRow.connected_at,
      },
      organisation: orgResult.data,
      broker: {
        ...brokerUserResult.data,
        ...brokerProfileResult.data,
      },
    })
  } catch (_error) {
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
