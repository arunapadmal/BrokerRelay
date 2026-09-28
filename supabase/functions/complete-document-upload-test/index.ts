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
  if (contentType === 'image/png') return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (contentType === 'image/heic' || contentType === 'image/heif') {
    if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false
    const brand = ascii(bytes, 8, 4)
    return ['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)
  }
  return false
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  let admin: any = null
  let uploadItem: any = null

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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    const { data: userData, error: userError } = await authClient.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401)
    const user = userData.user

    const body = await req.json()
    const uploadItemId = String(body.uploadItemId ?? '')
    if (!uploadItemId) return json({ error: 'UPLOAD_ITEM_REQUIRED' }, 400)

    const { data: item, error: itemError } = await admin
      .from('document_upload_items')
      .select('id,organisation_id,document_request_id,client_id,storage_object_path,original_file_name,content_type,size_bytes,state')
      .eq('id', uploadItemId)
      .single()

    if (itemError || !item) return json({ error: 'UPLOAD_ITEM_NOT_FOUND' }, 404)
    uploadItem = item

    const { data: clientRow } = await admin
      .from('clients')
      .select('user_id')
      .eq('id', item.client_id)
      .eq('organisation_id', item.organisation_id)
      .single()

    if (!clientRow || clientRow.user_id !== user.id) return json({ error: 'FORBIDDEN' }, 403)
    if (item.state !== 'ticket_created') return json({ error: 'UPLOAD_ITEM_NOT_OPEN' }, 409)

    const { data: blob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(item.storage_object_path)

    if (downloadError || !blob) return json({ error: 'OBJECT_NOT_FOUND' }, 404)

    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length <= 0 || bytes.length > MAX_BYTES || !matchesMagic(bytes, item.content_type)) {
      await admin.from('document_upload_items')
        .update({ state: 'failed', updated_at: new Date().toISOString() })
        .eq('id', item.id)

      await admin.from('document_transfer_events').insert({
        organisation_id: item.organisation_id,
        document_request_id: item.document_request_id,
        upload_item_id: item.id,
        actor_user_id: user.id,
        event_type: 'validation_failed',
        file_name_sanitised: item.original_file_name,
        content_type: item.content_type,
        size_bytes: bytes.length,
        error_code: 'FILE_SIGNATURE_INVALID',
        metadata: { test_mode: true },
      })

      await admin.storage.from(BUCKET).remove([item.storage_object_path])
      await admin.from('document_upload_items')
        .update({ purged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', item.id)
      await admin.from('document_requests')
        .update({ status: 'requested', updated_at: new Date().toISOString() })
        .eq('id', item.document_request_id)

      return json({ error: 'FILE_VALIDATION_FAILED' }, 400)
    }

    const now = new Date().toISOString()

    await admin.from('document_transfer_events').insert([
      {
        organisation_id: item.organisation_id,
        document_request_id: item.document_request_id,
        upload_item_id: item.id,
        actor_user_id: user.id,
        event_type: 'upload_completed',
        file_name_sanitised: item.original_file_name,
        content_type: item.content_type,
        size_bytes: bytes.length,
        metadata: { test_mode: true },
      },
      {
        organisation_id: item.organisation_id,
        document_request_id: item.document_request_id,
        upload_item_id: item.id,
        actor_user_id: user.id,
        event_type: 'validation_passed',
        file_name_sanitised: item.original_file_name,
        content_type: item.content_type,
        size_bytes: bytes.length,
        metadata: { test_mode: true, signature_check: true },
      },
    ])

    const { error: removeError } = await admin.storage
      .from(BUCKET)
      .remove([item.storage_object_path])

    if (removeError) {
      await admin.from('document_upload_items')
        .update({ state: 'failed', uploaded_at: now, updated_at: now })
        .eq('id', item.id)
      return json({ error: 'TEST_PURGE_FAILED' }, 500)
    }

    await admin.from('document_upload_items')
      .update({
        state: 'purged',
        uploaded_at: now,
        purged_at: now,
        size_bytes: bytes.length,
        updated_at: now,
      })
      .eq('id', item.id)

    await admin.from('document_transfer_events').insert({
      organisation_id: item.organisation_id,
      document_request_id: item.document_request_id,
      upload_item_id: item.id,
      actor_user_id: user.id,
      event_type: 'purge_completed',
      file_name_sanitised: item.original_file_name,
      content_type: item.content_type,
      size_bytes: bytes.length,
      metadata: { test_mode: true, reason: 'relay_provider_not_configured' },
    })

    await admin.from('document_requests')
      .update({ status: 'requested', updated_at: now })
      .eq('id', item.document_request_id)

    return json({
      ok: true,
      verified: true,
      purged: true,
      testMode: true,
      message: 'Secure upload verified and immediately purged. Email relay is not enabled yet.',
    })
  } catch (_error) {
    if (admin && uploadItem?.storage_object_path) {
      try {
        await admin.storage.from(BUCKET).remove([uploadItem.storage_object_path])
      } catch (_) {}
    }
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
})
