'use client'

import { useEffect, useState } from 'react'

type ColourKey = 'background' | 'text' | 'button' | 'notification'
export type MobileBranding = Record<ColourKey, string>
export const defaultMobileBranding: MobileBranding = {
  background: '#EFF6FF', text: '#10245B', button: '#2563EB', notification: '#EF4444',
}

function luminance(hex: string) {
  const values = [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function readableText(hex: string) {
  const lightness = luminance(hex)
  const whiteContrast = 1.05 / (lightness + 0.05)
  const darkContrast = (lightness + 0.05) / 0.05
  return whiteContrast >= darkContrast
    ? { colour: '#FFFFFF', contrast: whiteContrast }
    : { colour: '#000000', contrast: darkContrast }
}

export function brandingIsReadable(value: MobileBranding) {
  const validHex = (colour: unknown): colour is string =>
    typeof colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(colour)
  if (!value || ![value.background, value.text, value.button, value.notification].every(validHex)) return false
  return contrast(value.background, value.text) >= 4.5 &&
    readableText(value.button).contrast >= 4.5 &&
    readableText(value.notification).contrast >= 4.5
}

function ColourControl({ colour, label, onChange }: {
  colour: string; label: string; onChange: (colour: string) => void
}) {
  const [draft, setDraft] = useState(colour)
  useEffect(() => setDraft(colour), [colour])
  return <>
    <input type="color" value={colour} onChange={event => onChange(event.target.value)} aria-label={`${label} colour picker`} />
    <input className="brandingHex" value={draft} maxLength={7}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => /^#[0-9a-fA-F]{6}$/.test(draft) ? onChange(draft) : setDraft(colour)}
      aria-label={`${label} HEX colour`} />
  </>
}

export function MobileBrandingEditor({ value, onChange, logoUrl, companyName }: {
  value: MobileBranding
  onChange: (value: MobileBranding) => void
  logoUrl?: string | null
  companyName: string
}) {
  const [custom, setCustom] = useState(false)
  useEffect(() => {
    if (value.background !== defaultMobileBranding.background ||
        value.text !== defaultMobileBranding.text ||
        value.button !== defaultMobileBranding.button ||
        value.notification !== defaultMobileBranding.notification) setCustom(true)
  }, [value])
  const choices: { key: ColourKey; label: string; position: string }[] = [
    { key: 'background', label: 'Background', position: '② Page background' },
    { key: 'text', label: 'Background text', position: '③ Headings and labels on the background' },
    { key: 'button', label: 'Buttons', position: '④ Actions and selected navigation' },
    { key: 'notification', label: 'Notifications', position: '⑤ Unread badges and highlights' },
  ]
  const buttonText = readableText(value.button)
  const badgeText = readableText(value.notification)
  const readable = brandingIsReadable(value)
  function update(key: ColourKey, colour: string) {
    if (/^#[0-9a-fA-F]{6}$/.test(colour)) onChange({ ...value, [key]: colour.toUpperCase() })
  }
  return <div className="brandingLayout">
    <div>
      <p className="muted">Choose a starting theme. The preview changes as you select colours. Your clients see your company logo and colours after setup.</p>
      <div className="brandingChoices">
        <button type="button" className={!custom ? 'brandingChoice selected' : 'brandingChoice'} onClick={() => { setCustom(false); onChange(defaultMobileBranding) }}>Use BrokerRelay defaults</button>
        <button type="button" className={custom ? 'brandingChoice selected' : 'brandingChoice'} onClick={() => setCustom(true)}>Customise colours</button>
      </div>
      {custom && choices.map(({ key, label, position }) => <label key={key} className="brandingColour">
        <span><strong>{label}</strong><small>{position}</small></span>
        <ColourControl colour={value[key]} label={label} onChange={colour => update(key, colour)} />
      </label>)}
      {!readable && <p role="alert" className="notice error">Choose a background and text colour with enough contrast. Button and notification labels are adjusted automatically.</p>}
      <p className="muted">The BrokerRelay installed app icon stays the same. Company colours appear inside the app.</p>
    </div>
    <div className="brandingPreviewWrap">
      <p className="eyebrow">LIVE CLIENT APP PREVIEW</p>
      <div className="brandingPhone" style={{ background: value.background, color: value.text }}>
        <div className="brandingPhoneHeader" style={{ color: value.text }}><span className="brandingCompanyLogo">{logoUrl ? <img src={logoUrl} alt="Company logo preview" /> : '▣'}</span><strong>{companyName || 'Your company'} <sup>①</sup></strong><span>⚙</span></div>
        <h2 style={{ color: value.text }}>Welcome, Alex</h2><p style={{ color: value.text }}>How can we help you today?</p>
        <div className="brandingQuick">
          <span>☎<small>Call</small></span><span style={{ background: value.button, color: buttonText.colour }}>●<small>Messages</small></span><span>✉<small>Email</small></span>
        </div>
        <div className="brandingPreviewCard">⌂ &nbsp; My Loans <span>›</span></div>
        <div className="brandingPreviewCard">◉ &nbsp; Announcements <b style={{ background: value.notification, color: badgeText.colour }}>2</b></div>
        <div className="brandingPreviewCard">▤ &nbsp; Document Requests <span>›</span></div>
        <nav className="brandingPreviewNav"><span style={{ color: value.button }}>⌂<small>Home</small></span><span>●<small>Messages</small></span><span>▤<small>Documents</small></span><span>•••<small>More</small></span></nav>
      </div>
      <div className="brandingLegend">① Company logo · ② Background · ③ Background text · ④ Buttons · ⑤ Notifications</div>
    </div>
  </div>
}
