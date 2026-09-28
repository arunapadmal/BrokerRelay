'use client'

import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

type Invitation = {
  invitation_id?: string
  organisation_id: string
  organisation_name: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  roles: string[]
  needs_password_setup?: boolean
}

export default function AcceptStaffInvitationPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('Opening invitation…')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) {
      setMessage('This invitation link is invalid or expired.')
      return
    }
    const { data, error } = await supabase.rpc('get_my_staff_invitations')
    if (error) {
      setMessage(error.message)
      return
    }
    const pending = (data ?? []) as Invitation[]
    setInvitations(pending)
    setMessage(pending.length ? '' : 'No pending staff invitation was found for this account.')
  }

  useEffect(() => {
    void load()
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void load()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function accept(event: FormEvent, invitation: Invitation) {
    event.preventDefault()
    setMessage('')
    const needsPassword = invitation.needs_password_setup === true
    if (needsPassword && password.length < 10) {
      setMessage('Use at least 10 characters.')
      return
    }
    if (needsPassword && password !== confirm) {
      setMessage('Passwords do not match.')
      return
    }
    setSubmitting(true)
    if (needsPassword) {
      const { error: passwordError } = await supabase.auth.updateUser({ password })
      if (passwordError) {
        setMessage(passwordError.message)
        setSubmitting(false)
        return
      }
    }
    const { error } = await supabase.rpc('accept_staff_invitation', {
      p_organisation_id: invitation.organisation_id,
    })
    if (error) {
      const friendly = error.message.includes('broker_profiles_organisation_id_broker_code_key')
        ? 'This broker code is already assigned to another staff member. Ask the company administrator to cancel this invitation and send a new one with a unique broker code.'
        : error.message
      setMessage(friendly)
      setSubmitting(false)
      return
    }
    setMessage('Invitation accepted. Redirecting to BrokerDesk…')
    window.setTimeout(() => { window.location.href = '/dashboard' }, 800)
  }

  return <main className="center"><div className="card narrow">
    <BrokerRelayBrand compact />
    <h1>Accept staff invitation</h1>
    {invitations.map(invitation => {
      const fullName = [invitation.first_name, invitation.last_name].filter(Boolean).join(' ') || 'Invited staff member'
      const needsPassword = invitation.needs_password_setup === true
      return <form key={invitation.invitation_id ?? invitation.organisation_id} onSubmit={event => accept(event, invitation)}>
        <p><strong>{fullName}</strong>, you have been invited to <strong>{invitation.organisation_name}</strong>.</p>
        {invitation.email && <p className="muted">{invitation.email}</p>}
        <p className="muted">Roles: {invitation.roles.map(role => role.replaceAll('_', ' ')).join(', ')}</p>
        {needsPassword ? <>
          <label>Create password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} autoComplete="new-password" required />
          <label>Confirm password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={10} autoComplete="new-password" required />
        </> : <p>This invitation uses your existing account. Accept it, then sign in with your current password. If you do not know that password, use “Forgot password?” on the BrokerDesk sign-in page.</p>}
        <button disabled={submitting}>{submitting ? 'Accepting…' : 'Accept invitation'}</button>
      </form>
    })}
    {message && <p>{message}</p>}
  </div></main>
}
