import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'mortgage-document-relay'
const MAX_BYTES = 15 * 1024 * 1024

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function starts(bytes: Uint8Array, values: number[]) {
  return values.every((v, i) => bytes[i] === v)
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function matchesMagic(bytes: Uint8Array, contentType: string) {
  if (contentType === 'application/pdf') return ascii(bytes, 0, 5) === '%PDF-'
  if (contentType === 'image/jpeg') return starts(bytes, [0xff, 0xd8, 0xff])
  if (contentType === 'image/png') {
    return starts(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
  }
  if (contentType === 'image/heic' || contentType === 'image/heif') {
    if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false
    return ['heic','heix','hevc','hevx','mif1','msf1'].includes(ascii(bytes,8,4))
  }
  return false
}

function base64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;")
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const relayFrom = Deno.env.get('DOCUMENT_RELAY_FROM') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  if (!url || !anonKey || !serviceKey || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'UNAUTHENTICATED' }, 401)
  }

  const jwt = authHeader.slice(7)
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: userData, error: userError } = await authClient.auth.getUser(jwt)
  if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
  const user = userData.user

  const body = await req.json().catch(() => ({}))
  const uploadItemId = String(body.uploadItemId ?? '')
  if (!uploadItemId) return json({ error: 'UPLOAD_ITEM_REQUIRED' }, 400)

  const { data: item, error: itemError } = await admin
    .from('document_upload_items')
    .select('id,organisation_id,document_request_id,client_id,storage_object_path,original_file_name,content_type,size_bytes,state')
    .eq('id', uploadItemId)
    .single()

  if (itemError || !item) return json({ error: 'UPLOAD_ITEM_NOT_FOUND' }, 404)

  const { data: clientRow } = await admin
    .from('clients')
    .select('user_id,first_name,last_name')
    .eq('id', item.client_id)
    .eq('organisation_id', item.organisation_id)
    .single()

  if (!clientRow || clientRow.user_id !== user.id) return json({ error: 'FORBIDDEN' }, 403)
  if (item.state !== 'ticket_created') return json({ error: 'UPLOAD_ITEM_NOT_OPEN' }, 409)

  const { data: requestRow, error: requestError } = await admin
    .from('document_requests')
    .select('id,title,description,status,application_id,delivery_endpoint_id,delivery_email_snapshot,requested_by_user_id')
    .eq('id', item.document_request_id)
    .eq('organisation_id', item.organisation_id)
    .eq('client_id', item.client_id)
    .single()

  if (requestError || !requestRow) return json({ error: 'REQUEST_NOT_FOUND' }, 404)
  if (!['requested','upload_in_progress','failed'].includes(requestRow.status)) {
    return json({ error: 'REQUEST_NOT_OPEN' }, 409)
  }

  const { data: endpoint } = await admin
    .from('document_delivery_endpoints')
    .select('id,email,active,verified_at,user_id,endpoint_type')
    .eq('id', requestRow.delivery_endpoint_id)
    .eq('organisation_id', item.organisation_id)
    .maybeSingle()

  if (!endpoint || !endpoint.active || !endpoint.verified_at ||
      !(endpoint.user_id === requestRow.requested_by_user_id ||
        (endpoint.endpoint_type === 'company' && endpoint.user_id === null)) ||
      endpoint.email.toLowerCase() !== String(requestRow.delivery_email_snapshot).toLowerCase()) {
    return json({ error: 'VERIFIED_DELIVERY_ENDPOINT_REQUIRED' }, 409)
  }

  const { data: objectBlob, error: downloadError } = await admin.storage
    .from(BUCKET).download(item.storage_object_path)

  if (downloadError || !objectBlob) return json({ error: 'OBJECT_NOT_FOUND' }, 404)

  const bytes = new Uint8Array(await objectBlob.arrayBuffer())
  const now = new Date().toISOString()

  if (bytes.length <= 0 || bytes.length > MAX_BYTES || !matchesMagic(bytes, item.content_type)) {
    await admin.from('document_upload_items')
      .update({ state:'failed', uploaded_at:now, updated_at:now }).eq('id',item.id)
    await admin.from('document_transfer_events').insert({
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,
      actor_user_id:user.id,
      event_type:'validation_failed',
      file_name_sanitised:item.original_file_name,
      content_type:item.content_type,
      size_bytes:bytes.length,
      error_code:'FILE_SIGNATURE_INVALID'
    })
    await admin.storage.from(BUCKET).remove([item.storage_object_path])
    await admin.from('document_upload_items')
      .update({ purged_at:new Date().toISOString(), updated_at:new Date().toISOString() })
      .eq('id',item.id)
    await admin.from('document_requests')
      .update({ status:'failed', updated_at:new Date().toISOString() })
      .eq('id',item.document_request_id)
    return json({ error:'FILE_VALIDATION_FAILED' },400)
  }

  await admin.from('document_transfer_events').insert([
    {
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'upload_completed',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length
    },
    {
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'validation_passed',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
      metadata:{signature_check:true}
    }
  ])

  if (!resendKey || !relayFrom) {
    await admin.storage.from(BUCKET).remove([item.storage_object_path])
    await admin.from('document_upload_items')
      .update({ state:'purged',uploaded_at:now,purged_at:new Date().toISOString(),updated_at:new Date().toISOString() })
      .eq('id',item.id)
    await admin.from('document_transfer_events').insert({
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'purge_completed',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
      metadata:{reason:'email_provider_not_configured'}
    })
    await admin.from('document_requests')
      .update({ status:'requested',updated_at:new Date().toISOString() })
      .eq('id',item.document_request_id)
    return json({
      error:'EMAIL_PROVIDER_NOT_CONFIGURED',
      purged:true,
      setupRequired:true
    },503)
  }

  let appNumber: string | null = null
  if (requestRow.application_id) {
    const { data: app } = await admin.from('loan_applications')
      .select('application_reference')
      .eq('id',requestRow.application_id)
      .eq('organisation_id',item.organisation_id)
      .maybeSingle()
    appNumber = app?.application_reference ?? null
  }

  const { data: brokerProfile } = await admin.from('profiles')
    .select('first_name,last_name')
    .eq('id',requestRow.requested_by_user_id)
    .maybeSingle()

  // The requester receives a copy only while still an active broker in this company.
  // The address comes from the verified Auth account, never a client-supplied field.
  const { data: activeBroker } = await admin.from('broker_profiles')
    .select('user_id').eq('organisation_id', item.organisation_id)
    .eq('user_id', requestRow.requested_by_user_id).eq('is_active', true).maybeSingle()
  const { data: activeMember } = await admin.from('organisation_memberships')
    .select('user_id').eq('organisation_id', item.organisation_id)
    .eq('user_id', requestRow.requested_by_user_id)
    .eq('status', 'active').is('removed_at', null).maybeSingle()
  let brokerCopyEmail: string | null = null
  if (activeBroker && activeMember) {
    const { data: brokerAccount } = await admin.auth.admin.getUserById(requestRow.requested_by_user_id)
    const brokerEmail = brokerAccount.user?.email?.trim().toLowerCase()
    if (brokerAccount.user?.email_confirmed_at && brokerEmail &&
        brokerEmail !== endpoint.email.trim().toLowerCase()) brokerCopyEmail = brokerEmail
  }

  const clientName = [clientRow.first_name,clientRow.last_name].filter(Boolean).join(' ')
  const brokerName = [brokerProfile?.first_name,brokerProfile?.last_name].filter(Boolean).join(' ')

  await admin.from('document_upload_items')
    .update({ state:'relay_processing',uploaded_at:now,updated_at:now }).eq('id',item.id)
  await admin.from('document_requests')
    .update({ status:'relay_processing',updated_at:now }).eq('id',item.document_request_id)
  await admin.from('document_transfer_events').insert({
    organisation_id:item.organisation_id,
    document_request_id:item.document_request_id,
    upload_item_id:item.id,actor_user_id:user.id,event_type:'relay_started',
    file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
    metadata:{provider:'resend'}
  })

  const { data: organisation } = await admin.from('organisations')
    .select('name').eq('id', item.organisation_id).maybeSingle()
  const companyName = organisation?.name ?? 'BrokerRelay'
  const subject = appNumber
    ? `${companyName} document received · Application ${appNumber}`
    : `${companyName} document received`

  const html = `<p>A document requested through ${esc(companyName)} has been securely uploaded.</p>
    <p><strong>Client:</strong> ${esc(clientName)}<br/>
    <strong>Request:</strong> ${esc(requestRow.title)}
    ${appNumber ? `<br/><strong>Application Number:</strong> ${esc(appNumber)}` : ''}</p>
    <p>The attachment is sent to the verified company delivery mailbox${brokerCopyEmail ? `, with a private copy to ${esc(brokerName || 'the requesting broker')}` : ''}.</p>
    <p><small>The document is purged from temporary relay storage after email provider acceptance.</small></p>`

  let providerId: string | null = null
  let relayAccepted = false
  let relayError = ''

  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${resendKey}`,
        'Idempotency-Key':`aidez-document-relay/${item.id}`
      },
      body:JSON.stringify({
        from:relayFrom,
        to:[endpoint.email],
        ...(brokerCopyEmail ? {bcc:[brokerCopyEmail]} : {}),
        subject,
        html,
        attachments:[{
          content:base64(bytes),
          filename:item.original_file_name,
          content_type:item.content_type
        }],
        tags:[
          {name:'category',value:'document_relay'},
          {name:'request_id',value:item.document_request_id.replaceAll('-','')}
        ]
      })
    })

    const emailData = await emailResponse.json().catch(() => ({}))
    if (emailResponse.ok && emailData?.id) {
      relayAccepted = true
      providerId = String(emailData.id)
    } else {
      relayError = `RESEND_${emailResponse.status}`
    }
  } catch (_error) {
    relayError = 'RESEND_NETWORK_ERROR'
  }

  if (relayAccepted) {
    const acceptedAt = new Date().toISOString()
    await admin.from('document_transfer_events').insert({
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'relay_accepted',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
      provider_message_id:providerId,
      metadata:{provider:'resend',delivery_email:endpoint.email,broker_copy_email:brokerCopyEmail}
    })
    await admin.from('document_upload_items')
      .update({ state:'relayed',relayed_at:acceptedAt,updated_at:acceptedAt }).eq('id',item.id)
    await admin.from('document_requests')
      .update({ status:'relayed',fulfilled_at:acceptedAt,updated_at:acceptedAt })
      .eq('id',item.document_request_id)

    const { error: purgeError } = await admin.storage.from(BUCKET).remove([item.storage_object_path])
    const purgeAt = new Date().toISOString()

    if (purgeError) {
      await admin.from('document_transfer_events').insert({
        organisation_id:item.organisation_id,
        document_request_id:item.document_request_id,
        upload_item_id:item.id,actor_user_id:user.id,event_type:'purge_failed',
        file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
        provider_message_id:providerId,error_code:'STORAGE_PURGE_FAILED'
      })
      return json({
        ok:true,relayed:true,purged:false,providerMessageId:providerId,
        warning:'EMAIL_ACCEPTED_PURGE_REQUIRES_ATTENTION'
      },200)
    }

    await admin.from('document_upload_items')
      .update({ state:'purged',purged_at:purgeAt,updated_at:purgeAt }).eq('id',item.id)
    await admin.from('document_transfer_events').insert({
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'purge_completed',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
      provider_message_id:providerId,metadata:{provider:'resend',after:'relay_accepted'}
    })
    await admin.from('audit_events').insert({
      organisation_id:item.organisation_id,
      actor_user_id:user.id,event_type:'document_relay_completed',
      entity_type:'document_request',entity_id:item.document_request_id,
      metadata:{
        client_id:item.client_id,application_id:requestRow.application_id,
        provider:'resend',provider_message_id:providerId,
        delivery_endpoint_id:endpoint.id,purged:true
      }
    })

    return json({ok:true,relayed:true,purged:true,providerMessageId:providerId})
  }

  await admin.from('document_transfer_events').insert({
    organisation_id:item.organisation_id,
    document_request_id:item.document_request_id,
    upload_item_id:item.id,actor_user_id:user.id,event_type:'relay_failed',
    file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
    error_code:relayError || 'RELAY_FAILED',metadata:{provider:'resend'}
  })

  const { error: purgeError } = await admin.storage.from(BUCKET).remove([item.storage_object_path])
  const failedAt = new Date().toISOString()
  await admin.from('document_upload_items').update({
    state:purgeError ? 'failed' : 'purged',
    purged_at:purgeError ? null : failedAt,
    updated_at:failedAt
  }).eq('id',item.id)
  await admin.from('document_requests')
    .update({status:'failed',updated_at:failedAt}).eq('id',item.document_request_id)

  if (!purgeError) {
    await admin.from('document_transfer_events').insert({
      organisation_id:item.organisation_id,
      document_request_id:item.document_request_id,
      upload_item_id:item.id,actor_user_id:user.id,event_type:'purge_completed',
      file_name_sanitised:item.original_file_name,content_type:item.content_type,size_bytes:bytes.length,
      metadata:{reason:'relay_failed'}
    })
  }

  return json({error:'EMAIL_RELAY_FAILED',code:relayError,purged:!purgeError},502)
})
