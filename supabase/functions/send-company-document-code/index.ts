import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
const escapeHtml = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'UNAUTHENTICATED' }, 401)
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const relayFrom = Deno.env.get('DOCUMENT_RELAY_FROM') ?? ''
  if (!url || !anonKey || !serviceKey || !resendKey || !relayFrom) {
    return json({ error: 'DOCUMENT_EMAIL_PROVIDER_NOT_CONFIGURED' }, 503)
  }

  const input = await req.json().catch(() => ({}))
  const organisationId = String(input.organisation_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(organisationId)) return json({ error: 'INVALID_COMPANY' }, 400)
  const member = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await member.auth.getUser(authHeader.slice(7))
  if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
  const { data: access, error: accessError } = await member.rpc('get_my_portal_access')
  if (accessError || !access?.is_head_broker || access.organisation_id !== organisationId) {
    return json({ error: 'HEAD_BROKER_REQUIRED' }, 403)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: rows, error: challengeError } = await admin.rpc('issue_company_document_email_code', {
    p_organisation_id: organisationId,
  })
  if (challengeError || !rows?.[0]) {
    const message = challengeError?.message ?? ''
    return json({ error: message.includes('WAIT_BEFORE_RESENDING')
      ? 'WAIT_BEFORE_RESENDING' : 'PENDING_DELIVERY_EMAIL_REQUIRED' }, 400)
  }
  const { email, code, company_name: companyName } = rows[0]
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: relayFrom, to: [email],
      subject: `${companyName} document delivery email verification`,
      html: `<p>The Head Broker for <strong>${escapeHtml(companyName)}</strong> requested this address for document delivery.</p>
        <p>Enter this code in BrokerDesk within 15 minutes: <strong>${code}</strong></p>
        <p>If you did not request it, ignore this message. Documents cannot be sent here until verified.</p>`,
    }),
  }).catch(() => null)
  if (!response?.ok) return json({ error: 'VERIFICATION_EMAIL_NOT_SENT' }, 502)
  return json({ ok: true })
})
