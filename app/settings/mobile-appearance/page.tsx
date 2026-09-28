'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MobileBrandingEditor, brandingIsReadable, defaultMobileBranding, type MobileBranding } from '@/components/MobileBrandingEditor'
import '@/components/mobile-branding.css'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

type Company = {
  id: string; name: string; head_broker_user_id: string
  logo_url: string | null
  mobile_background_color: string
  mobile_text_color: string
  mobile_button_color: string
  mobile_notification_color: string
}

function logoPublicUrl(path: string | null) {
  if (!path) return null
  if (/^https:\/\//.test(path)) return path
  return supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl
}

export default function MobileAppearancePage() {
  const [company, setCompany] = useState<Company | null>(null)
  const [branding, setBranding] = useState<MobileBranding>(defaultMobileBranding)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [setup, setSetup] = useState(false)

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(window.location.search)
    setSetup(params.get('setup') === '1')
    async function load() {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { window.location.href = '/login'; return }
      const requestedOrg = params.get('org')
      const { data: profile, error: profileError } = await supabase.from('broker_profiles')
        .select('organisation_id').eq('user_id', auth.user.id).eq('is_active', true)
        .limit(1).maybeSingle()
      if (!active) return
      if (profileError || !profile) { setError('No active company was found for your account.'); return }
      const id = profile.organisation_id as string
      if (requestedOrg && requestedOrg !== id) { setError('You cannot edit this company.'); return }
      const { data, error: loadError } = await supabase.from('organisations')
        .select('id,name,head_broker_user_id,logo_url,mobile_background_color,mobile_text_color,mobile_button_color,mobile_notification_color')
        .eq('id', id).single()
      if (!active) return
      if (loadError || !data) { setError(loadError?.message ?? 'Company not found.'); return }
      if (data.head_broker_user_id !== auth.user.id) { setError('Only the Head Broker can change mobile app appearance.'); return }
      const row = data as Company
      setCompany(row)
      setBranding({
        background: row.mobile_background_color || defaultMobileBranding.background,
        text: row.mobile_text_color || defaultMobileBranding.text,
        button: row.mobile_button_color || defaultMobileBranding.button,
        notification: row.mobile_notification_color || defaultMobileBranding.notification,
      })
    }
    void load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function chooseLogo(next: File | null) {
    setError('')
    if (next && (!['image/png','image/jpeg','image/webp'].includes(next.type) || next.size > 2 * 1024 * 1024)) {
      setError('Choose a PNG, JPEG or WebP logo no larger than 2 MB.')
      return
    }
    setFile(next)
    if (next) setRemoveLogo(false)
  }

  async function save() {
    if (!company || busy) return
    if (!brandingIsReadable(branding)) { setError('Choose background and text colours with enough contrast.'); return }
    setBusy(true); setError(''); setNotice('')
    let path: string | null = removeLogo ? null : company.logo_url
    if (file) {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      path = `${company.id}/logo.${ext}`
      const { error: uploadError } = await supabase.storage.from('company-logos')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '60' })
      if (uploadError) { setError(uploadError.message); setBusy(false); return }
    }
    const { error: saveError } = await supabase.rpc('save_company_mobile_branding', {
      p_organisation_id: company.id,
      p_background_color: branding.background,
      p_text_color: branding.text,
      p_button_color: branding.button,
      p_notification_color: branding.notification,
      p_logo_path: path,
    })
    setBusy(false)
    if (saveError) { setError(saveError.message); return }
    setCompany({ ...company, logo_url: path, mobile_background_color: branding.background, mobile_text_color: branding.text,
      mobile_button_color: branding.button, mobile_notification_color: branding.notification })
    setFile(null); setRemoveLogo(false)
    if (setup) { window.location.href = '/dashboard'; return }
    setNotice('Mobile appearance published. Clients will see it when their app refreshes.')
  }

  return <ApplicationWorkspaceShell section="mobile">
    <header className="applicationHeader"><div><p className="eyebrow">COMPANY SETTINGS</p><h1>Mobile app appearance</h1><p className="muted">Set your company logo and colours for the client app.</p></div></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {company && <section className="card">
      <p className="eyebrow">{setup ? 'FINAL SETUP STEP' : 'COMPANY SETTINGS'}</p>
      <h2>{company.name}</h2>
      <p className="muted">Upload your company logo or keep the standard business icon. Choose colours and check the phone preview before publishing.</p>
      <label>Company logo (optional)
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => chooseLogo(event.target.files?.[0] ?? null)} />
      </label>
      {(file || company.logo_url) && <button type="button" className="secondary" onClick={() => { setFile(null); setRemoveLogo(true) }}>Use standard business icon</button>}
      <MobileBrandingEditor value={branding} onChange={setBranding} companyName={company.name}
        logoUrl={removeLogo ? null : previewUrl ?? logoPublicUrl(company.logo_url)} />
      <button type="button" disabled={busy || !brandingIsReadable(branding)} onClick={save}>{busy ? 'Saving…' : setup ? 'Save and finish setup' : 'Publish changes'}</button>
      {setup && <p className="muted"><Link href="/dashboard">Continue with defaults and add a logo later</Link></p>}
    </section>}
  </ApplicationWorkspaceShell>
}
