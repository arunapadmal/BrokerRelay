'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { CompanyBillingPanel } from '@/components/CompanyBillingPanel'
export default function BillingPage() {
 const [org, setOrg] = useState<string | null>(null), [error, setError] = useState('')
 useEffect(() => { void (async () => { const { data: auth } = await supabase.auth.getUser(); if (!auth.user) { window.location.href='/login'; return } const { data, error: failure } = await supabase.rpc('get_my_portal_access'); if (failure) setError(failure.message); else if (!data?.is_head_broker) setError('Company billing is available to the Head Broker.'); else setOrg(data.organisation_id) })() }, [])
 return <ApplicationWorkspaceShell section="billing"><header className="applicationHeader"><div><p className="eyebrow">COMPANY SETTINGS</p><h1>Billing &amp; invoices</h1><p className="muted">Your company package, settlement allowance and invoice history.</p></div></header>{error && <p className="notice error" role="alert">{error}</p>}{org && <CompanyBillingPanel companyId={org} />}</ApplicationWorkspaceShell>
}
