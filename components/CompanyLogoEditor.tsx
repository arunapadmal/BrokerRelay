'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  companyId: string
  companyName: string
  logoUrl: string | null
  logoWidth: number
  logoHeight: number
  onUpdated: (url: string) => void
  onDimensionsUpdated: (width: number, height: number) => void
}

const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function CompanyLogoEditor({ companyId, companyName, logoUrl, logoWidth, logoHeight, onUpdated, onDimensionsUpdated }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [width, setWidth] = useState(logoWidth)
  const [height, setHeight] = useState(logoHeight)

  useEffect(() => { setWidth(logoWidth); setHeight(logoHeight) }, [logoWidth, logoHeight])

  async function saveSize() {
    if (busy) return
    if (!Number.isInteger(width) || width < 80 || width > 240 || !Number.isInteger(height) || height < 40 || height > 120) {
      setError('Width must be 80–240 px and height must be 40–120 px.')
      return
    }
    setBusy(true); setError(''); setMessage('')
    const { data, error: saveError } = await supabase.from('organisations')
      .update({ logo_display_width: width, logo_display_height: height }).eq('id', companyId)
      .select('logo_display_width,logo_display_height').single()
    if (saveError || !data) setError(`Could not save logo size: ${saveError?.message ?? 'Company could not be updated.'}`)
    else { onDimensionsUpdated(data.logo_display_width, data.logo_display_height); setMessage('Logo size saved for this company.') }
    setBusy(false)
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    setError(''); setMessage('')
    const extension = imageExtensions[file.type]
    if (!extension) { setError('Choose a PNG, JPEG or WebP image.'); return }
    if (file.size > 2 * 1024 * 1024) { setError('The logo must be smaller than 2 MB.'); return }

    setBusy(true)
    const path = `${companyId}/${crypto.randomUUID()}.${extension}`
    const bucket = supabase.storage.from('company-logos')
    const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError) { setError(`Could not upload logo: ${uploadError.message}`); setBusy(false); return }

    const url = bucket.getPublicUrl(path).data.publicUrl
    const { data, error: saveError } = await supabase.from('organisations')
      .update({ logo_url: url }).eq('id', companyId).select('id').single()
    if (saveError || !data) {
      await bucket.remove([path])
      setError(`Could not save logo: ${saveError?.message ?? 'Company could not be updated.'}`)
    } else {
      onUpdated(url)
      setMessage('Company logo updated.')
      const oldPrefix = `${new URL(url).origin}/storage/v1/object/public/company-logos/${companyId}/`
      if (logoUrl?.startsWith(oldPrefix)) {
        const oldPath = decodeURIComponent(new URL(logoUrl).pathname.split('/company-logos/')[1] ?? '')
        if (oldPath.startsWith(`${companyId}/`)) await bucket.remove([oldPath])
      }
    }
    setBusy(false)
  }

  return <div className="platformLogoEditor">
    <div className="platformLogoPreview" style={{ width: `${Math.min(240, Math.max(80, width || 160))}px`, height: `${Math.min(120, Math.max(40, height || 72))}px` }}>{logoUrl ? <img src={logoUrl} alt={`${companyName} logo`} /> : <span aria-hidden="true">{companyName.charAt(0).toUpperCase()}</span>}</div>
    <div><strong>Company logo</strong><p className="muted smallText">PNG, JPEG or WebP · up to 2 MB</p>
      <label className="platformLogoUpload">{busy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Add logo'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={upload} /></label>
      <div className="platformLogoDimensions"><label>Width (px)<input type="number" min="80" max="240" value={width} disabled={busy} onChange={event => setWidth(Number(event.target.value))} /></label><label>Height (px)<input type="number" min="40" max="120" value={height} disabled={busy} onChange={event => setHeight(Number(event.target.value))} /></label><button type="button" className="secondary small" disabled={busy || (width === logoWidth && height === logoHeight)} onClick={saveSize}>Save size</button></div>
      {error && <p className="platformLogoError" role="alert">{error}</p>}
      {message && <p className="platformLogoSuccess" role="status">{message}</p>}
    </div>
  </div>
}
