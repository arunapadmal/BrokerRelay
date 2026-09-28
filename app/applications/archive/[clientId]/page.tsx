'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

type Client = {
  id: string
  first_name: string
  last_name: string
}

type Application = {
  id: string
  application_reference: string | null
  application_description: string | null
  status: string
  client_note: string | null
  settlement_date: string | null
  archived_at: string | null
  status_updated_at: string
  created_at: string
}

type History = {
  id: number
  application_id: string
  from_status: string | null
  to_status: string
  client_note: string | null
  created_at: string
}

const labels: Record<string, string> = {
  preparing_application: 'Preparing Application',
  documents_required: 'Documents Required',
  ready_to_submit: 'Ready to Submit',
  submitted: 'Submitted',
  under_assessment: 'Under Assessment',
  conditional_approval: 'Conditional Approval',
  formal_approval: 'Formal Approval',
  loan_documents_issued: 'Loan Documents Issued',
  settlement_scheduled: 'Settlement Scheduled',
  settled: 'Settled',
  on_hold: 'On Hold',
  withdrawn: 'Withdrawn',
}

const label = (value: string) => labels[value] ?? value

export default function ApplicationArchivePage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params.clientId

  const [client, setClient] = useState<Client | null>(null)
  const [apps, setApps] = useState<Application[]>([])
  const [history, setHistory] = useState<History[]>([])
  const [error, setError] = useState('')

  async function load() {
    setError('')

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('id,first_name,last_name')
      .eq('id', clientId)
      .single()

    if (clientError) {
      setError(clientError.message)
      return
    }
    setClient(clientData as Client)

    const { data: applicationData, error: applicationError } = await supabase
      .from('loan_applications')
      .select(
        'id,application_reference,application_description,status,client_note,settlement_date,archived_at,status_updated_at,created_at',
      )
      .eq('client_id', clientId)
      .eq('client_view_state', 'past')
      .order('archived_at', { ascending: false })

    if (applicationError) {
      setError(applicationError.message)
      return
    }

    const rows = (applicationData ?? []) as Application[]
    setApps(rows)

    if (rows.length === 0) {
      setHistory([])
      return
    }

    const { data: historyData, error: historyError } = await supabase
      .from('application_status_history')
      .select(
        'id,application_id,from_status,to_status,client_note,created_at',
      )
      .in(
        'application_id',
        rows.map((row) => row.id),
      )
      .order('created_at', { ascending: false })

    if (historyError) {
      setError(historyError.message)
      return
    }

    setHistory((historyData ?? []) as History[])
  }

  useEffect(() => {
    void load()

    const channel = supabase
      .channel(`application-archive-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loan_applications',
          filter: `client_id=eq.${clientId}`,
        },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [clientId])

  const historyByApplication = useMemo(() => {
    const grouped: Record<string, History[]> = {}
    for (const item of history) {
      grouped[item.application_id] ??= []
      grouped[item.application_id].push(item)
    }
    return grouped
  }, [history])

  const clientName = client
    ? `${client.first_name} ${client.last_name}`
    : 'Client'

  return (
    <ApplicationWorkspaceShell clientId={clientId} section="archive">
      <header className="applicationHeader">
        <div>
          <p className="eyebrow">ARCHIVE / PAST APPLICATIONS</p>
          <h1>{clientName} · Archive</h1>
          <p className="muted">
            Withdrawn applications and settled applications that have completed
            the active 90-day period are retained here automatically.
          </p>
        </div>
        <div className="systemOfRecord">
          Read-only history · nothing is deleted
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      {apps.length === 0 ? (
        <section className="card">
          <h2>No archived applications</h2>
          <p className="muted">
            There are currently no withdrawn or archived applications for this client.
          </p>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {apps.map((application) => {
            const name =
              application.application_description ||
              application.application_reference ||
              'Past application'
            const items = historyByApplication[application.id] ?? []

            return (
              <section className="card" key={application.id}>
                <div className="sectionHead">
                  <div>
                    <p className="eyebrow">
                      {application.application_reference
                        ? `APPLICATION ${application.application_reference}`
                        : 'PAST APPLICATION'}
                    </p>
                    <h2>{name}</h2>
                  </div>
                  <div className="systemOfRecord">
                    {label(application.status)}
                  </div>
                </div>

                <p className="muted">
                  {application.archived_at
                    ? `Moved to Archive ${new Date(
                        application.archived_at,
                      ).toLocaleString()}`
                    : `Last updated ${new Date(
                        application.status_updated_at,
                      ).toLocaleString()}`}
                </p>

                {application.settlement_date && (
                  <p>
                    <strong>Settlement date:</strong>{' '}
                    {application.settlement_date}
                  </p>
                )}

                {application.client_note && (
                  <div className="clientNotePreview">
                    <strong>Last client-facing update:</strong>
                    <br />
                    {application.client_note}
                  </div>
                )}

                <details style={{ marginTop: 18 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
                    View complete status history ({items.length})
                  </summary>

                  <div className="statusHistory" style={{ marginTop: 16 }}>
                    {items.map((item) => (
                      <div className="historyItem" key={item.id}>
                        <div className="historyDot" />
                        <div>
                          <strong>{label(item.to_status)}</strong>
                          <div className="muted smallText">
                            {new Date(item.created_at).toLocaleString()}
                          </div>
                          {item.client_note && <p>{item.client_note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            )
          })}
        </div>
      )}
    </ApplicationWorkspaceShell>
  )
}
