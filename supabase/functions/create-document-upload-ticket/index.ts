import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'mortgage-document-relay'
const MAX_BYTES = 15 * 1024 * 1024
const allowed: Record<string, string[]> = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heif', 'image/heic'],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeName(value: string) {
  const leaf = value.split(/[\\/]/).pop() ?? 'document'
  return leaf.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
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

    const jwt = authHeader.slice(7)
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    const { data: userData, error: userError } = await authClient.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
    const user = userData.user

    const body = await req.json()
    const requestId = String(body.documentRequestId ?? '')
    const originalName = safeName(String(body.fileName ?? ''))
    const contentType = String(body.contentType ?? '').toLowerCase()
    const sizeBytes = Number(body.sizeBytes ?? 0)

    const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : ''
    if (!requestId || !originalName || !allowed[ext]?.includes(contentType)) {
      return json({ error: 'UNSUPPORTED_FILE_TYPE' }, 400)
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
      return json({ error: 'FILE_SIZE_INVALID', maxBytes: MAX_BYTES }, 400)
    }

    const { data: requestRow, error: requestError } = await admin
      .from('document_requests')
      .select('id,organisation_id,client_id,status,max_files')
      .eq('id', requestId)
      .single()

    if (requestError || !requestRow) return json({ error: 'REQUEST_NOT_FOUND' }, 404)
    if (!['requested', 'failed'].includes(requestRow.status)) {
      return json({ error: 'REQUEST_NOT_OPEN' }, 409)
    }

    const { data: clientRow, error: clientError } = await admin
      .from('clients')
      .select('id,user_id')
      .eq('id', requestRow.client_id)
      .eq('organisation_id', requestRow.organisation_id)
      .single()

    if (clientError || !clientRow || clientRow.user_id !== user.id) {
      return json({ error: 'FORBIDDEN' }, 403)
    }

    const { count, error: countError } = await admin
      .from('document_upload_items')
      .select('id', { count: 'exact', head: true })
      .eq('document_request_id', requestId)
      .in('state', ['ticket_created', 'uploaded', 'validating', 'relay_processing', 'relayed'])

    if (countError) return json({ error: 'UPLOAD_COUNT_FAILED' }, 500)
    if ((count ?? 0) >= requestRow.max_files) {
      return json({ error: 'MAX_FILES_REACHED' }, 409)
    }

    const uploadId = crypto.randomUUID()
    const path = [
      requestRow.organisation_id,
      requestRow.client_id,
      requestId,
      uploadId,
      originalName,
    ].join('/')
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const { error: insertError } = await admin.from('document_upload_items').insert({
      id: uploadId,
      organisation_id: requestRow.organisation_id,
      document_request_id: requestId,
      client_id: requestRow.client_id,
      storage_object_path: path,
      original_file_name: originalName,
      content_type: contentType,
      size_bytes: sizeBytes,
      state: 'ticket_created',
      expires_at: expiresAt,
    })
    if (insertError) return json({ error: 'UPLOAD_TICKET_CREATE_FAILED' }, 500)

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)

    if (signError || !signed?.token) {
      await admin.from('document_upload_items').update({ state: 'failed' }).eq('id', uploadId)
      return json({ error: 'SIGNED_UPLOAD_FAILED' }, 500)
    }

    await admin.from('document_transfer_events').insert({
      organisation_id: requestRow.organisation_id,
      document_request_id: requestId,
      upload_item_id: uploadId,
      actor_user_id: user.id,
      event_type: 'upload_ticket_created',
      file_name_sanitised: originalName,
      content_type: contentType,
      size_bytes: sizeBytes,
      metadata: { expires_at: expiresAt, test_mode: true },
    })

    await admin.from('document_requests')
      .update({ status: 'upload_in_progress', updated_at: new Date().toISOString() })
      .eq('id', requestId)

    return json({
      uploadItemId: uploadId,
      bucket: BUCKET,
      path,
      token: signed.token,
      expiresAt,
      maxBytes: MAX_BYTES,
      testMode: true,
    })
  } catch (_error) {
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
