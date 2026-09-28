'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Client = { id: string; first_name: string; last_name: string }

type Props = { clientId?: string; route: (id: string) => string; label?: string }

export function WorkspaceClientPicker({ clientId, route, label = 'Client' }: Props) {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    async function load() {
      const { data: auth } = await supabase.auth.getUser()
      if (!active) return
      if (!auth.user) { router.replace('/login'); return }
      const { data, error: loadError } = await supabase.from('clients')
        .select('id,first_name,last_name').order('first_name').order('last_name')
      if (!active) return
      setClients((data ?? []) as Client[])
      setError(loadError?.message ?? '')
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [router])
  return <div className="workspaceClientPicker">
    <label htmlFor="workspace-client">{label}</label>
    <select id="workspace-client" value={clientId ?? ''} disabled={loading} onChange={event => {
      if (event.target.value) router.push(route(event.target.value))
    }}>
      <option value="">{loading ? 'Loading clients…' : 'Select a client…'}</option>
      {clients.map(client => <option value={client.id} key={client.id}>{client.first_name} {client.last_name}</option>)}
    </select>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !error && clients.length === 0 && <p className="muted">No connected clients available.</p>}
  </div>
}
