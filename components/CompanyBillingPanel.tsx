'use client'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BillingPlan, BillingSummary, BillingInvoice, monthStart, monthLabel, money } from '@/lib/billing'
import { BillingInvoiceView } from '@/components/BillingInvoiceView'
import './billing.css'
import { CompanyAutomaticPayments } from '@/components/CompanyAutomaticPayments'
export function CompanyBillingPanel({ companyId, owner = false }: { companyId: string; owner?: boolean }) {
 const [summary, setSummary] = useState<BillingSummary | null>(null)
 const [plans, setPlans] = useState<BillingPlan[]>([])
 const [invoices, setInvoices] = useState<BillingInvoice[]>([])
 const [preview, setPreview] = useState<BillingInvoice | null>(null)
 const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null)
 const [plan, setPlan] = useState('basic'), [status, setStatus] = useState('active'), [grace, setGrace] = useState('')
 const [month, setMonth] = useState(monthStart(-1))
 const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
 async function load() {
  const [s, p, i] = await Promise.all([supabase.rpc('billing_summary', { p_org: companyId }), supabase.from('billing_plan_versions').select('*').lte('effective_from', monthStart()).order('effective_from', { ascending: false }), supabase.from('billing_invoices').select('*').eq('organisation_id', companyId).order('month', { ascending: false })])
  const failure = s.error || p.error || i.error
  if (failure) { setError(failure.code === 'PGRST202' || failure.code === '42P01' ? 'Billing is not installed yet. Apply the billing SQL update, then refresh.' : failure.message); return }
  const value = s.data as BillingSummary; setSummary(value); setInvoices(i.data ?? [])
  const unique = new Map<string, BillingPlan>(); for (const row of p.data ?? []) if (!unique.has(row.plan_key)) unique.set(row.plan_key, row)
  setPlans([...unique.values()]); setPlan(value.subscription?.next_plan_key || value.subscription?.plan_key || 'basic'); setStatus(value.subscription?.status || 'active'); setGrace(value.subscription?.grace_until || ''); setError('')
 }
 useEffect(() => { setPreview(null); setSelectedInvoice(null); void load() }, [companyId])
 async function action(run: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
  if (busy) return; setBusy(true); setError(''); setNotice('')
  try { const r = await run(); if (r.error) setError(r.error.message); else { await load(); setNotice(success) } } catch (e) { setError(e instanceof Error ? e.message : 'Could not save billing change.') } finally { setBusy(false) }
 }
 async function assign(event: FormEvent) { event.preventDefault(); if (!window.confirm(summary?.subscription ? 'Save status and schedule any package change for next month?' : 'Activate this company subscription? This starts a full calendar-month subscription and any configured setup fee.')) return; await action(() => supabase.rpc('billing_assign', { p_org: companyId, p_key: plan, p_status: status, p_grace: grace || null }), 'Billing updated. Package changes take effect next month.') }
 async function showPreview() {
  if (busy) return; setBusy(true); setError(''); setPreview(null)
  try {
   const [fresh, company, settings, charges] = await Promise.all([
    supabase.rpc('billing_summary', { p_org: companyId }),
    supabase.from('organisations').select('name,legal_name,abn,billing_email').eq('id', companyId).single(),
    supabase.from('billing_settings').select('supplier_name,supplier_abn,supplier_address').eq('id', true).single(),
    supabase.from('billing_one_time_charges').select('description,cents').eq('organisation_id', companyId).eq('month', monthStart())
   ])
   const failure = fresh.error || company.error || settings.error || charges.error; if (failure) throw new Error(failure.message)
   const current = fresh.data as BillingSummary; if (!current.cycle) throw new Error('Assign a subscription before previewing an invoice.')
   setSummary(current); const c = current.cycle
   const records = await supabase.from('billing_settlements').select('application_id,application_number,broker_name,settlement_date,recorded_at').eq('cycle_id',c.id).eq('organisation_id',companyId).order('recorded_at').order('application_id'); if(records.error)throw new Error(records.error.message)
   const lines = [{ description: `${c.plan_name} monthly subscription (${c.included_settlements} settlements included)`, quantity: 1, unit_cents: c.monthly_cents, total_cents: c.monthly_cents }, { description: 'Extra settlements', quantity: current.extra ?? 0, unit_cents: c.extra_cents, total_cents: (current.extra ?? 0) * c.extra_cents }, ...(charges.data ?? []).map(r => ({ description: r.description, quantity: 1, unit_cents: r.cents, total_cents: r.cents }))]
   const subtotal = lines.reduce((sum, line) => sum + line.total_cents, 0); const gst = Math.round(subtotal / 10)
   setSelectedInvoice(null); setPreview({ id: 'preview', settlement_records: (records.data ?? []).map((r,index)=>({application_number:r.application_number || 'Unavailable',broker_name:r.broker_name || 'Historical broker not recorded',settlement_date:r.settlement_date,included:index<c.included_settlements,charge_cents:index<c.included_settlements?0:c.extra_cents})), invoice_number: 0, month: c.month, status: 'preview', subtotal_cents: subtotal, gst_cents: gst, gst_rate: 10, total_cents: subtotal + gst, due_date: '', issued_at: '', paid_at: null, payment_reference: null, lines, company_snapshot: company.data, supplier_snapshot: { name: settings.data.supplier_name, abn: settings.data.supplier_abn, address: settings.data.supplier_address } })
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not load invoice preview.') } finally { setBusy(false) }
 }
 const completedMonths: string[] = []
 if (summary?.subscription) { let cursor = monthStart(-1); while (cursor >= summary.subscription.start_month && completedMonths.length < 1200) { completedMonths.push(cursor); const d = new Date(`${cursor}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); cursor = d.toISOString().slice(0, 10) } }
 const billingMonth = completedMonths.includes(month) ? month : completedMonths[0]
 const invoice = invoices.find(i => i.id === selectedInvoice)
 return <section className="card billingPanel"><p className="eyebrow">COMPANY BILLING</p><h2>Subscription &amp; invoices</h2>
  {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  {summary?.subscription && summary.cycle ? <><div className="billingStats"><div><small>Current package</small><strong>{summary.cycle.plan_name}</strong><span>{money(summary.cycle.monthly_cents)} / month + GST</span></div><div><small>{monthLabel(summary.cycle.month)}</small><strong>{summary.used} of {summary.cycle.included_settlements}</strong><span>settlements used</span></div><div><small>Extra settlements</small><strong>{summary.extra}</strong><span>{money(summary.cycle.extra_cents)} each + GST</span></div><div><small>Estimated usage bill (ex GST)</small><strong>{money(summary.estimated_cents ?? 0)}</strong><span>GST and one-time fees shown on invoice</span></div></div>
   <p>Status: <strong>{summary.subscription.status.replaceAll('_', ' ')}</strong>{!summary.active && ' · Relationship announcements and follow-ups are paused.'}</p>
   {(summary.used ?? 0) >= summary.cycle.included_settlements && <p className="notice">The included allowance has been used. Additional settlements cost {money(summary.cycle.extra_cents)} each + GST.</p>}
   {summary.subscription.next_plan_key && <p className="notice">Scheduled package: {summary.subscription.next_plan_key} from {monthLabel(summary.subscription.next_plan_from!)}.</p>}
   <p className="muted">Allowances reset on the first of each month in Melbourne time and do not roll over. Each application counts once when settlement is first recorded.</p></> : summary && <p className="muted">No subscription assigned. Ask the Platform Owner to activate a package.</p>}
  {owner && <form onSubmit={assign} className="billingForm billingNoPrint"><label>Package<select value={plan} onChange={e => setPlan(e.target.value)}>{plans.map(p => <option key={p.id} value={p.plan_key}>{p.name} · {money(p.monthly_cents)} · {p.included_settlements} settlements</option>)}</select></label><label>Subscription status<select value={status} onChange={e => setStatus(e.target.value)}><option value="active">Active</option><option value="past_due">Past due</option><option value="suspended">Suspended</option></select></label>{status === 'past_due' && <label>Grace through<input type="date" value={grace} onChange={e => setGrace(e.target.value)} /></label>}<p className="muted">New subscriptions start this calendar month at the full monthly price. Existing package changes start next month.</p><button disabled={busy || !plans.length}>Save company billing</button></form>}
  {owner && summary?.cycle && <div className="billingForm billingNoPrint"><h3>Current month invoice preview</h3><p className="muted">Review {monthLabel(summary.cycle.month)}, including the subscription, extra settlements and one-time fees. The total may change before the month ends.</p><button type="button" className="secondary" disabled={busy} onClick={() => void showPreview()}>Preview current month</button></div>}
  {owner && summary?.subscription && (completedMonths.length ? <form className="billingForm billingNoPrint" onSubmit={e => { e.preventDefault(); setPreview(null); void action(() => supabase.rpc('billing_generate_invoice', { p_org: companyId, p_month: billingMonth }), 'Invoice issued. Select it below to print or save as PDF.') }}><label>Completed billing month<select value={billingMonth} onChange={e => setMonth(e.target.value)}>{completedMonths.map(m => <option value={m} key={m}>{monthLabel(m)}</option>)}</select></label><button disabled={busy}>Generate invoice</button></form> : <p className="notice">Your first billing month is still in progress. A final invoice will be available after {monthLabel(summary.subscription.start_month)} ends. You can preview it now.</p>)}
  {preview && <BillingInvoiceView invoice={preview} preview />}
  {summary?.subscription && <CompanyAutomaticPayments companyId={companyId} owner={owner} />}
  <p className="muted">Invoices for the previous calendar month are generated on the 1st in Melbourne time. When automation is enabled, invoices go to your company billing email. Authorised direct debit is scheduled seven days after notice; receipts follow confirmed payment.</p>
  <div className="billingInvoiceList billingNoPrint"><h3>Invoices</h3><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Refresh invoices</button></div>{!invoices.length && <p className="muted">Invoices appear after a completed month has been billed.</p>}
  <div className="billingInvoiceList billingNoPrint">{invoices.map(i => <button type="button" className="secondary" key={i.id} onClick={() => { setPreview(null); setSelectedInvoice(i.id) }}>BR-{String(i.invoice_number).padStart(6, '0')} · {monthLabel(i.month)} · {money(i.total_cents)} · {i.status}</button>)}</div>
  {invoice && <><BillingInvoiceView invoice={invoice} />{owner && invoice.delivery_error && <button type="button" className="secondary billingNoPrint" disabled={busy} onClick={()=>void action(()=>supabase.rpc('billing_retry_delivery',{p_invoice:invoice.id}),'Delivery job queued for retry.')}>Retry delivery after correcting settings</button>}{owner && invoice.status === 'issued' && <form className="billingForm billingNoPrint" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (window.confirm('Confirm payment has been received for this invoice?')) void action(() => supabase.rpc('billing_mark_paid', { p_id: invoice.id, p_reference: String(f.get('reference') || '') }), 'Payment recorded.') }}><label>Received payment reference<input name="reference" required minLength={2} placeholder="Bank reference or receipt number" /></label><button disabled={busy}>Record received payment</button></form>}</>}
 </section>
}
