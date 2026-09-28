'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'

type Person = { user_id: string; first_name: string | null; last_name: string | null; email: string | null }
type Assignment = Person & { assignment_role: 'primary_broker' | 'broker' | 'assistant' }
type Team = {
  can_manage_primary: boolean
  can_manage_assistants: boolean
  assignments: Assignment[]
  eligible_brokers: Person[]
  eligible_assistants: Person[]
}

const personName = (person: Person) =>
  `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email || 'Staff member'

export default function ClientServiceTeamPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const [clientName, setClientName] = useState('Client')
  const [team, setTeam] = useState<Team | null>(null)
  const [primary, setPrimary] = useState('')
  const [assistant, setAssistant] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const assignedAssistants = useMemo(
    () => team?.assignments.filter(row => row.assignment_role === 'assistant') ?? [],
    [team],
  )

  async function load() {
    setMessage('')
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { window.location.href = '/login'; return }
    const [{ data, error }, { data: client }] = await Promise.all([
      supabase.rpc('get_client_service_team', { p_client_id: clientId }),
      supabase.from('clients').select('first_name,last_name').eq('id', clientId).single(),
    ])
    if (error) { setMessage(error.message); return }
    const next = data as Team
    setTeam(next)
    setPrimary(next.assignments.find(row => row.assignment_role === 'primary_broker')?.user_id ?? '')
    if (client) setClientName(`${client.first_name} ${client.last_name}`.trim())
  }

  useEffect(() => { void load() }, [clientId])

  async function savePrimary() {
    if (!primary) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('set_client_primary_broker', { p_client_id: clientId, p_broker_user_id: primary })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setMessage('Primary broker updated.'); await load()
  }

  async function addAssistant() {
    if (!assistant) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('set_client_assistant', { p_client_id: clientId, p_assistant_user_id: assistant, p_assigned: true })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setAssistant(''); setMessage('Broker assistant assigned.'); await load()
  }

  async function removeAssistant(userId: string) {
    if (!window.confirm('Remove this assistant from the client service team? Access ends immediately.')) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('set_client_assistant', { p_client_id: clientId, p_assistant_user_id: userId, p_assigned: false })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setMessage('Broker assistant removed.'); await load()
  }

  return <ApplicationWorkspaceShell clientId={clientId} section="team">
    <header className="applicationHeader"><div><p className="eyebrow">CLIENT ACCESS</p><h1>{clientName} · Service team</h1><p className="muted">Only people explicitly assigned here can open this client’s applications, messages and documents.</p></div></header>
    <WorkspaceClientPicker clientId={clientId} route={id => `/clients/${id}/team`} />
    {message && <div className="notice">{message}</div>}

    <section className="card" style={{marginTop:24}}>
      <h2>Primary broker</h2>
      {team?.can_manage_primary ? <div className="row">
        <select value={primary} onChange={event => setPrimary(event.target.value)}>
          <option value="">Select broker…</option>
          {team.eligible_brokers.map(person => <option key={person.user_id} value={person.user_id}>{personName(person)}</option>)}
        </select>
        <button disabled={busy || !primary} onClick={savePrimary}>Save primary broker</button>
      </div> : <p><strong>{team?.assignments.find(row => row.assignment_role === 'primary_broker') ? personName(team.assignments.find(row => row.assignment_role === 'primary_broker')!) : 'Not assigned'}</strong></p>}
      <p className="muted">Exactly one primary broker services the client. Only the Head Broker can reassign this responsibility.</p>
    </section>

    <section className="card" style={{marginTop:16}}>
      <h2>Broker assistants</h2>
      {assignedAssistants.length === 0 ? <p className="muted">No assistant is assigned.</p> : assignedAssistants.map(person =>
        <div className="sectionHead" key={person.user_id}><div><strong>{personName(person)}</strong><p className="muted">{person.email}</p></div>
          {team?.can_manage_assistants && <button className="danger" disabled={busy} onClick={() => removeAssistant(person.user_id)}>Remove access</button>}
        </div>)}
      {team?.can_manage_assistants && <div className="row" style={{marginTop:16}}>
        <select value={assistant} onChange={event => setAssistant(event.target.value)}>
          <option value="">Select broker assistant…</option>
          {team.eligible_assistants.filter(person => !assignedAssistants.some(row => row.user_id === person.user_id)).map(person =>
            <option key={person.user_id} value={person.user_id}>{personName(person)}</option>)}
        </select>
        <button disabled={busy || !assistant} onClick={addAssistant}>Assign assistant</button>
      </div>}
    </section>
  </ApplicationWorkspaceShell>
}
