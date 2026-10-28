'use client'

import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Decision = { partner_id: string; decision: string; decided_at: string; note: string }
type Transfer = {
  id: string; company_name: string; status: string; effective_from: string; reason: string
  original_partner_id: string | null; from_beneficiary_id: string | null; to_partner_id: string
  original_name: string | null; from_name: string | null; to_name: string
  my_partner_id: string | null; receiver_offer_id: string; review_note: string | null
  receiver_offer: { commission_enabled: boolean; rate_bps: number; eligible_fee_categories: string[] }
  decisions: Decision[]
}
type Props = { owner?: boolean; refreshKey?: number; onChange?: () => void }

export function PartnerTransfers({ owner = false, refreshKey = 0, onChange }: Props) {
  const [items, setItems] = useState<Transfer[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    const result = await supabase.rpc('partner_transfer_list')
    if (result.error) { setError(result.error.message); return }
    setItems(result.data ?? [])
  }
  useEffect(() => { void load() }, [refreshKey])
  async function decide(event: FormEvent<HTMLFormElement>, transfer: Transfer) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const accept = form.get('decision') === 'accept'
    setBusy(true); setError(''); setNotice('')
    const result = owner
      ? await supabase.rpc('partner_admin_review_transfer', { p_transfer_id: transfer.id, p_approve: accept, p_note: String(form.get('note')) })
      : await supabase.rpc('partner_transfer_decide', { p_transfer_id: transfer.id, p_accept: accept, p_note: String(form.get('note')) })
    setBusy(false)
    if (result.error) setError(result.error.message)
    else { setNotice('Decision recorded. Existing commission history remains unchanged.'); await load(); onChange?.() }
  }
  return <section className="card billingPanel"><h2>Account manager and recurring commission transfers</h2>
    <p>The original referrer stays on the company record. Transfers affect future subscription and settlement usage rights from the effective date. The receiving manager earns commission only on fees expressly included in their accepted offer.</p>
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!items.length && <p>No transfer requests.</p>}
    {items.map(t => {
      const required = [...new Set([t.original_partner_id, t.from_beneficiary_id, t.to_partner_id].filter(Boolean))]
      const allAccepted = required.every(id => t.decisions.some(d => d.partner_id === id && d.decision === 'accepted'))
      const mine = t.decisions.find(d => d.partner_id === t.my_partner_id)
      const relevant = required.includes(t.my_partner_id)
      const categories = t.receiver_offer.eligible_fee_categories.filter(f => f !== 'setup')
      return <article className="billingInvoice" key={t.id} style={{ marginBottom: 20 }}>
        <h3>{t.company_name} · {t.status}</h3>
        <p>Original referrer: <strong>{t.original_name ?? 'None recorded'}</strong><br />Current recurring beneficiary: {t.from_name ?? 'None'}<br />Receiving account manager: <strong>{t.to_name}</strong><br />Effective date: {t.effective_from} (Australia/Melbourne)</p>
        <p>{t.reason}</p>
        <p>Receiving offer: {t.receiver_offer.commission_enabled && categories.length ? `${t.receiver_offer.rate_bps / 100}% of collected ${categories.join(' and ')} fees, excluding GST and refunds` : 'No recurring commission offered'}. Setup commission is excluded from this transfer.</p>
        <p className="muted smallText">Offer reference: {t.receiver_offer_id}. Earlier service periods and charge events retain the earlier beneficiary, including payments collected later.</p>
        <p>Partner approvals: {t.decisions.filter(d => d.decision === 'accepted').length} of {required.length}. {t.decisions.some(d => d.decision === 'rejected') && 'A participant rejected this request.'}</p>
        {mine && <p>Your decision: {mine.decision} · {new Date(mine.decided_at).toLocaleString('en-AU')}</p>}
        {t.review_note && <p>Owner review: {t.review_note}</p>}
        {t.status === 'pending' && (owner || (relevant && !mine)) && <form className="billingForm" onSubmit={e => void decide(e, t)}>
          <label>Decision<select name="decision"><option value="accept">{owner ? 'Approve after all partner acceptances' : 'Accept the transfer and exact receiving offer above'}</option><option value="reject">{owner ? 'Cancel request' : 'Reject transfer'}</option></select></label>
          <label>Decision note<input name="note" required minLength={5} maxLength={1000} /></label>
          {owner && !allAccepted && <p className="muted">Approval will remain blocked until all required participants accept. You can cancel at any time.</p>}
          {!owner && <label className="check"><input type="checkbox" required />I approve this company, receiving manager, offer and effective date. I understand past entitlements remain unchanged.</label>}
          <button disabled={busy}>Record {owner ? 'owner review' : 'my decision'}</button>
        </form>}
      </article>
    })}
  </section>
}
