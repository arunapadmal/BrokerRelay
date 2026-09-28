'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import './admin.css'

const roleOptions = [
  ['broker', 'Broker'],
  ['administrator', 'Administrator'],
  ['accounts', 'Accounts'],
  ['hr', 'HR'],
  ['broker_assistant', 'Broker Assistant'],
] as const

const permissionOptions = [
  ['manage_staff', 'Manage staff'],
  ['transfer_clients', 'Transfer clients'],
  ['manage_announcements', 'Manage announcements'],
  ['view_finance', 'View finance'],
  ['manage_finance', 'Manage finance'],
  ['manage_hr', 'Manage HR'],
] as const

type Company = {
  id: string; name: string; legal_name: string | null; abn: string | null
  billing_email: string | null; contact_phone: string | null; website: string | null
  status: string
}

type Member = {
  membership_id: string; user_id: string; email: string
  first_name: string; last_name: string; status: 'invited' | 'active' | 'disabled'
  disabled_reason: string | null; roles: string[]; permissions: string[]
  assigned_clients: number
}

type Snapshot = { organisation: Company; members: Member[] }
type PendingInvitation = { id: string; email: string; first_name: string; last_name: string; roles: string[]; expires_at: string; resend_count: number }

function validAbn(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return true
  if (digits.length !== 11) return false
  const values = digits.split('').map(Number)
  values[0] -= 1
  return values.reduce((sum, digit, index) => sum + digit * [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19][index], 0) % 89 === 0
}

function validPhone(value: string) {
  if (!value.trim()) return true
  if (!/^[+()\d\s-]+$/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  return (digits.length === 10 && digits.startsWith('0')) || (digits.length === 11 && digits.startsWith('61'))
}

function validWebsite(value: string) {
  if (!value.trim()) return true
  if (/\s/.test(value)) return false
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') } catch { return false }
}

export default function AdministrationPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, setSelected] = useState<Member | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [transferTo, setTransferTo] = useState('')
  const [pending, setPending] = useState<PendingInvitation[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [ownershipTarget, setOwnershipTarget] = useState('')
  const [formerHeadRoles, setFormerHeadRoles] = useState<string[]>(['broker'])
  const latestLoad = useRef(0)

  async function load() {
    const loadId = ++latestLoad.current
    setError('')
    const { data: auth } = await supabase.auth.getUser()
    if (loadId !== latestLoad.current) return
    if (!auth.user) { window.location.href = '/login'; return }
    setCurrentUserId(auth.user.id)
    let { data, error: loadError } = await supabase.rpc('admin_get_company_snapshot', {
      p_organisation_id: null,
    })
    for (let attempt = 0; attempt < 2 && loadError?.code === 'PGRST303'
      && /JWT issued at future/i.test(loadError.message); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
      if (loadId !== latestLoad.current) return
      const retried = await supabase.rpc('admin_get_company_snapshot', { p_organisation_id: null })
      data = retried.data
      loadError = retried.error
    }
    if (loadId !== latestLoad.current) return
    if (loadError) { setError(loadError.message); return }
    const next = data as Snapshot
    let { data: lifecycle, error: lifecycleError } = await supabase.rpc('admin_get_staff_lifecycle', { p_organisation_id: next.organisation.id })
    for (let attempt = 0; attempt < 2 && lifecycleError?.code === 'PGRST303'
      && /JWT issued at future/i.test(lifecycleError.message); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
      if (loadId !== latestLoad.current) return
      const retried = await supabase.rpc('admin_get_staff_lifecycle', { p_organisation_id: next.organisation.id })
      lifecycle = retried.data
      lifecycleError = retried.error
    }
    if (loadId !== latestLoad.current) return
    if (lifecycleError) { setError(lifecycleError.message); return }
    const removed = new Set<string>((lifecycle?.removed_user_ids ?? []) as string[])
    next.members = next.members.filter(member => !removed.has(member.user_id) && member.status !== 'invited')
    setPending((lifecycle?.pending ?? []) as PendingInvitation[])
    setSnapshot(next)
    setError('')
    if (selected) {
      const refreshed = next.members.find((member) => member.user_id === selected.user_id) ?? null
      setSelected(refreshed)
      setRoles(refreshed?.roles ?? [])
      setPermissions(refreshed?.permissions ?? [])
    }
  }

  useEffect(() => { void load() }, [])

  function choose(member: Member) {
    setSelected(member)
    setRoles(member.roles)
    setPermissions(member.permissions)
    setTransferTo('')
    setMessage('')
    setError('')
  }

  async function saveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const phone = String(form.get('contact_phone') ?? '')
    const website = String(form.get('website') ?? '')
    if (!validPhone(phone)) { setError('Enter a valid phone number.'); return }
    if (!validWebsite(website)) { setError('Website must be a complete http:// or https:// URL.'); return }
    setBusy(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.rpc('admin_update_company_contacts', {
      p_organisation_id: snapshot.organisation.id,
      p_billing_email: String(form.get('billing_email') ?? ''),
      p_contact_phone: phone,
      p_website: website,
    })
    setBusy(false)
    if (saveError) { setError(saveError.message); return }
    setMessage('Company contact details updated.'); await load()
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    const form = new FormData(event.currentTarget)
    const inviteRoles = roleOptions.filter(([key]) => form.get(`role-${key}`)).map(([key]) => key)
    setBusy(true); setError(''); setMessage('')
    const { data, error: inviteError } = await supabase.functions.invoke('admin-invite-staff', {
      body: {
        organisation_id: snapshot.organisation.id,
        first_name: form.get('first_name'), last_name: form.get('last_name'),
        email: form.get('email'), broker_code: form.get('broker_code'),
        title: form.get('title'), roles: inviteRoles,
      },
    })
    setBusy(false)
    if (inviteError || data?.error) {
      setError(data?.detail ?? data?.error ?? inviteError?.message ?? 'Invitation failed.'); return
    }
    setMessage(data.email_sent ? 'Invitation email sent. Access remains pending until accepted.' : 'Invitation recorded. Access remains pending until accepted.')
    setInviteOpen(false); await load()
  }

  async function saveRoles() {
    if (!snapshot || !selected || roles.length === 0) return
    setBusy(true); setError(''); setMessage('')
    const { error: roleError } = await supabase.rpc('admin_set_staff_roles', {
      p_organisation_id: snapshot.organisation.id,
      p_user_id: selected.user_id,
      p_roles: roles,
    })
    setBusy(false)
    if (roleError) { setError(roleError.message); return }
    setMessage('Staff roles updated.'); await load()
  }

  async function savePermissions() {
    if (!snapshot || !selected) return
    setBusy(true); setError(''); setMessage('')
    const { error: permissionError } = await supabase.rpc('admin_set_staff_permissions', {
      p_organisation_id: snapshot.organisation.id,
      p_user_id: selected.user_id,
      p_permissions: permissions,
    })
    setBusy(false)
    if (permissionError) { setError(permissionError.message); return }
    setMessage('Delegated permissions updated.'); await load()
  }

  async function setStatus(status: 'active' | 'disabled') {
    if (!snapshot || !selected) return
    let reason: string | null = null
    if (status === 'disabled') {
      reason = window.prompt('Reason for deactivation (recorded in audit history):')
      if (reason === null) return
    }
    setBusy(true); setError(''); setMessage('')
    const { error: statusError } = await supabase.rpc('admin_set_staff_status', {
      p_organisation_id: snapshot.organisation.id,
      p_user_id: selected.user_id,
      p_status: status,
      p_reason: reason,
    })
    setBusy(false)
    if (statusError) { setError(statusError.message); return }
    setMessage(status === 'active' ? 'Staff member reactivated.' : 'Staff member deactivated.')
    await load()
  }

  async function resendInvitation(id: string) {
    setBusy(true); setError(''); setMessage('')
    const { data, error } = await supabase.functions.invoke('admin-invite-staff', { body: { action: 'resend', invitation_id: id } })
    setBusy(false)
    if (error || data?.error) { setError(data?.detail ?? data?.error ?? error?.message ?? 'Resend failed.'); return }
    setMessage('Invitation email resent without changing the pending invitation.'); await load()
  }

  async function cancelInvitation(id: string) {
    if (!window.confirm('Cancel this pending invitation?')) return
    const { error } = await supabase.rpc('admin_cancel_staff_invitation', { p_invitation_id: id })
    if (error) { setError(error.message); return }
    setMessage('Invitation cancelled.'); await load()
  }

  async function archiveStaff() {
    if (!snapshot || !selected || selected.status !== 'disabled') return
    if (!window.confirm('Remove this deactivated staff member from the directory? Audit history will be retained.')) return
    const { error } = await supabase.rpc('admin_archive_staff', { p_organisation_id: snapshot.organisation.id, p_user_id: selected.user_id })
    if (error) { setError(error.message); return }
    setSelected(null); setMessage('Staff member removed from the active directory.'); await load()
  }

  async function transferAllClients() {
    if (!snapshot || !selected || !transferTo) return
    const target = snapshot.members.find((member) => member.user_id === transferTo)
    if (!window.confirm(`Transfer all ${selected.assigned_clients} assigned client records to ${target?.first_name} ${target?.last_name}?`)) return
    setBusy(true); setError(''); setMessage('')
    const { data, error: transferError } = await supabase.rpc('admin_transfer_clients', {
      p_organisation_id: snapshot.organisation.id,
      p_from_user_id: selected.user_id,
      p_to_user_id: transferTo,
      p_client_ids: null,
      p_reason: 'Staff administration transfer',
    })
    setBusy(false)
    if (transferError) { setError(transferError.message); return }
    setMessage(`${data?.client_count ?? 0} client assignment(s) transferred.`); await load()
  }

  async function transferOwnership() {
    if (!snapshot || !ownershipTarget || formerHeadRoles.length === 0) return
    const target = snapshot.members.find((member) => member.user_id === ownershipTarget)
    if (!target) return
    setBusy(true); setError(''); setMessage('')
    const { error: transferError } = await supabase.rpc('admin_initiate_head_broker_transfer', {
      p_organisation_id: snapshot.organisation.id,
      p_new_head_broker_user_id: ownershipTarget,
      p_former_head_broker_roles: formerHeadRoles,
    })
    setBusy(false)
    if (transferError) { setError(transferError.message); return }
    setOwnershipTarget('')
    setMessage(`Ownership handover started. Confirm it from the Security actions card on your dashboard; ${target.first_name} will be asked only after your confirmation.`)
    await load()
  }

  const transferTargets = useMemo(() => snapshot?.members.filter((member) =>
    member.user_id !== selected?.user_id && member.status === 'active' &&
    member.roles.some((role) => role === 'broker' || role === 'head_broker')) ?? [], [snapshot, selected])

  const viewerIsHeadBroker = snapshot?.members.some((member) =>
    member.user_id === currentUserId && member.status === 'active' && member.roles.includes('head_broker')) ?? false

  const ownershipTargets = useMemo(() => snapshot?.members.filter((member) =>
    member.user_id !== currentUserId && member.status === 'active' && !member.roles.includes('head_broker')) ?? [],
  [snapshot, currentUserId])

  if (!snapshot) return <main className="page"><Link className="backLink" href="/dashboard">← BrokerDesk</Link>{error ? <div className="notice error">{error}</div> : <p>Loading administration…</p>}</main>

  const company = snapshot.organisation
  return (
    <main className="adminShell">
      <header className="adminShellHeader"><BrokerRelayBrand compact /><span>{company.name} · Company administration</span><Link href="/dashboard" className="button secondary small">BrokerDesk</Link></header>
      <div className="adminShellLayout"><nav className="adminShellNav" aria-label="Company administration navigation">
        <Link href="/dashboard">⌂ &nbsp; BrokerDesk</Link>
        <a href="#company-profile">▦ &nbsp; Company profile</a>
        <a href="#staff-directory">♙ &nbsp; Staff directory</a>
        {pending.length > 0 || inviteOpen ? <a href="#staff-invitations">✉ &nbsp; Invitations {pending.length > 0 && <span className="pill">{pending.length}</span>}</a> : <button type="button" onClick={() => setInviteOpen(true)}>✉ &nbsp; Invitations</button>}
        {viewerIsHeadBroker && <a href="#head-broker-handover">⇄ &nbsp; Head Broker handover</a>}
      </nav><div className="adminShellMain">
      <header className="adminHeader">
        <div><p className="eyebrow">COMPANY ADMINISTRATION</p><h1>Company &amp; staff</h1><p className="muted">{company.name} · {company.status}</p></div>
        <button onClick={() => setInviteOpen(!inviteOpen)}>{inviteOpen ? 'Close invitation' : '+ Invite staff'}</button>
      </header>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {inviteOpen && <form className="card adminForm" id="staff-invitations" onSubmit={invite}>
        <div className="sectionHead"><div><p className="eyebrow">NEW STAFF MEMBER</p><h2>Send invitation</h2></div></div>
        <div className="formGrid"><label>First name<input name="first_name" maxLength={80} required /></label><label>Last name<input name="last_name" maxLength={80} required /></label><label>Email<input name="email" type="email" required /></label><label>Broker code (broker roles only)<input name="broker_code" maxLength={80} /></label><label>Position title<input name="title" maxLength={120} /></label></div>
        <fieldset><legend>Roles</legend><p className="muted smallText">Select only the roles this person should receive. No role is selected automatically.</p><div className="checkGrid">{roleOptions.map(([key, label]) => <label className="check" key={key}><input type="checkbox" name={`role-${key}`} /> {label}</label>)}</div></fieldset>
        <button disabled={busy}>{busy ? 'Inviting…' : 'Send staff invitation'}</button>
      </form>}

      {pending.length > 0 && <section className="card" id={inviteOpen ? undefined : 'staff-invitations'}><div className="sectionHead"><div><p className="eyebrow">PENDING INVITATIONS</p><h2>{pending.length} awaiting acceptance</h2></div></div><div className="staffList">{pending.map(invitation => <div className="staffRow" key={invitation.id}><span><strong>{invitation.first_name} {invitation.last_name}</strong><small>{invitation.email}</small></span><span><small>{invitation.roles.map(role => role.replaceAll('_', ' ')).join(' · ')}</small><div className="row"><button type="button" disabled={busy} onClick={() => resendInvitation(invitation.id)}>Resend</button><button type="button" className="danger" disabled={busy} onClick={() => cancelInvitation(invitation.id)}>Cancel</button></div></span></div>)}</div></section>}

      <section className="adminGrid">
        <form className="card adminForm" id="company-profile" onSubmit={saveCompany}>
          <p className="eyebrow">COMPANY MANAGEMENT</p><h2>Company profile</h2>
          <div className="notice">Trading name, legal name and ABN are protected legal identity. A change requires a new company, except for a one-time controlled correction by a platform administrator.</div>
          <fieldset disabled={!viewerIsHeadBroker || busy}>
            <label>Trading name<input value={company.name} readOnly /></label>
            <label>Legal name<input value={company.legal_name ?? ''} readOnly /></label>
            <div className="formGrid"><label>ABN<input value={company.abn ?? ''} readOnly /></label><label>Billing email<input name="billing_email" type="email" defaultValue={company.billing_email ?? ''} /></label><label>Phone<input name="contact_phone" type="tel" defaultValue={company.contact_phone ?? ''} /></label><label>Website<input name="website" type="url" placeholder="https://example.com.au" defaultValue={company.website ?? ''} /></label></div>
            <button disabled={busy}>Save contact details</button>
          </fieldset>
        </form>

        <section className="card" id="staff-directory">
          <div className="sectionHead"><div><p className="eyebrow">STAFF DIRECTORY</p><h2>{snapshot.members.length} people</h2></div></div>
          <div className="staffList">{snapshot.members.map((member) => <button type="button" className={`staffRow ${selected?.user_id === member.user_id ? 'selected' : ''}`} key={member.user_id} onClick={() => choose(member)}><span><strong>{member.first_name} {member.last_name}</strong><small>{member.email}</small></span><span><small>{member.roles.map((role) => role.replaceAll('_', ' ')).join(' · ')}</small><span className={`status ${member.status}`}>{member.status}</span></span></button>)}</div>
        </section>
      </section>

      {viewerIsHeadBroker && <section className="card staffEditor" id="head-broker-handover">
        <div className="sectionHead"><div><p className="eyebrow">PROTECTED OWNERSHIP</p><h2>Start Head Broker handover</h2><p className="muted">No authority changes now. Both people must authenticate and confirm from their dashboards within 48 hours.</p></div></div>
        <div className="notice">The successor must be active staff in this company. You confirm first; the successor can then accept or decline. The final switch is atomic and permanently audited.</div>
        <label>New Head Broker<select value={ownershipTarget} onChange={(event) => setOwnershipTarget(event.target.value)}><option value="">Select active staff member…</option>{ownershipTargets.map((member) => <option key={member.user_id} value={member.user_id}>{member.first_name} {member.last_name} · {member.email}</option>)}</select></label>
        <fieldset><legend>Your roles after transfer</legend><div className="checkGrid">{roleOptions.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={formerHeadRoles.includes(key)} onChange={(event) => setFormerHeadRoles(event.target.checked ? [...formerHeadRoles, key] : formerHeadRoles.filter((role) => role !== key))} /> {label}</label>)}</div></fieldset>
        <button className="danger" onClick={transferOwnership} disabled={busy || !ownershipTarget || formerHeadRoles.length === 0}>{busy ? 'Starting…' : 'Start ownership handover'}</button>
      </section>}

      {selected && <section className="card staffEditor">
        <div className="sectionHead"><div><p className="eyebrow">STAFF MANAGEMENT</p><h2>{selected.first_name} {selected.last_name}</h2><p className="muted">{selected.email} · {selected.assigned_clients} assigned client(s)</p></div><button className="secondary" onClick={() => setSelected(null)}>Close</button></div>
        {selected.roles.includes('head_broker') && <div className="notice">This is the protected Head Broker account. Its ownership, roles, permissions and status cannot be changed here. Use the ownership-transfer section first.</div>}
        {selected.status !== 'active' && <div className="notice">This staff record is {selected.status}. Roles and permissions are read-only until the invitation is accepted or the staff member is reactivated.</div>}
        <fieldset disabled={selected.status !== 'active' || selected.roles.includes('head_broker')}><legend>Roles</legend><div className="checkGrid">{roleOptions.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={roles.includes(key)} onChange={(event) => setRoles(event.target.checked ? [...roles, key] : roles.filter((role) => role !== key))} /> {label}</label>)}</div></fieldset>
        <div className="row">{selected.status === 'active' && !selected.roles.includes('head_broker') && <button onClick={saveRoles} disabled={busy || roles.length === 0}>Save roles</button>}{selected.status === 'disabled' ? <><button className="secondary" onClick={() => setStatus('active')} disabled={busy}>Reactivate</button><button className="danger" onClick={archiveStaff} disabled={busy || selected.assigned_clients > 0}>Remove staff</button></> : selected.status === 'active' && !selected.roles.includes('head_broker') ? <button className="danger" onClick={() => setStatus('disabled')} disabled={busy || selected.assigned_clients > 0}>Deactivate</button> : null}</div>
        {selected.assigned_clients > 0 && <p className="notice">Transfer all assigned clients before deactivating or removing this staff member.</p>}
        <fieldset disabled={selected.status !== 'active' || selected.roles.includes('head_broker')}><legend>Explicit delegated permissions</legend><p className="muted smallText">These grants supplement the permissions inherited from roles. Company ownership cannot be delegated.</p><div className="checkGrid">{permissionOptions.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={permissions.includes(key)} onChange={(event) => setPermissions(event.target.checked ? [...permissions, key] : permissions.filter((permission) => permission !== key))} /> {label}</label>)}</div></fieldset>
        {selected.status === 'active' && !selected.roles.includes('head_broker') && <button className="secondary" onClick={savePermissions} disabled={busy}>Save delegated permissions</button>}
        {selected.assigned_clients > 0 && <div className="transferBox"><h3>Transfer assigned clients</h3><p className="muted">Use this before deactivating a departing broker. The transfer is atomic and audited.</p><div className="row"><select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}><option value="">Select receiving broker…</option>{transferTargets.map((member) => <option key={member.user_id} value={member.user_id}>{member.first_name} {member.last_name}</option>)}</select><button onClick={transferAllClients} disabled={busy || !transferTo}>Transfer all clients</button></div></div>}
      </section>}
      </div></div>
    </main>
  )
}
