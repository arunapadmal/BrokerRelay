'use client'

import Link from 'next/link'
import { ChangeEvent, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'

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
}

type DocumentRequest = {
  document_request_id: string
  application_id: string | null
  application_number: string | null
  application_description: string | null
  document_type: string | null
  title: string
  description: string | null
  status: string
  max_files: number
  requested_at: string
  fulfilled_at: string | null
}

const statusLabel: Record<string, string> = {
  requested: 'Requested',
  upload_in_progress: 'Upload in progress',
  relay_processing: 'Relay processing',
  relayed: 'Relayed to broker',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
}

export default function ClientDocumentRequestsPage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params.clientId

  const [client, setClient] = useState<Client | null>(null)
  const [applications, setApplications] = useState<Application[]>([])
  const [requests, setRequests] = useState<DocumentRequest[]>([])

  const [applicationId, setApplicationId] = useState('')
  const [documentType, setDocumentType] = useState('other')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [maxFiles, setMaxFiles] = useState(1)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setError('')

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    const [
      { data: clientData, error: clientError },
      { data: applicationData, error: applicationError },
      { data: requestData, error: requestError },
    ] = await Promise.all([
      supabase
        .from('clients')
        .select('id,first_name,last_name')
        .eq('id', clientId)
        .single(),
      supabase
        .from('loan_applications')
        .select('id,application_reference,application_description,status')
        .eq('client_id', clientId)
        .neq('status', 'withdrawn')
        .order('created_at', { ascending: false }),
      supabase.rpc('list_document_requests_for_client', {
        p_client_id: clientId,
      }),
    ])

    if (clientError) {
      setError(clientError.message)
      return
    }
    setClient(clientData as Client)

    if (applicationError) {
      setError(applicationError.message)
    } else {
      setApplications((applicationData ?? []) as Application[])
    }

    if (requestError) {
      setError(requestError.message)
    } else {
      setRequests((requestData ?? []) as DocumentRequest[])
    }
  }

  useEffect(() => {
    void load()

    const channel = supabase
      .channel(`document-requests-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_requests',
          filter: `client_id=eq.${clientId}`,
        },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [clientId])

  async function createRequest() {
    if (!title.trim() || !applicationId || busy) return

    setBusy(true)
    setError('')
    setNotice('')

    const { error: createError } = await supabase.rpc(
      'create_document_request',
      {
        p_client_id: clientId,
        p_application_id: applicationId || null,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_document_type: documentType || null,
        p_max_files: maxFiles,
      },
    )

    setBusy(false)

    if (createError) {
      setError(createError.message)
      return
    }

    setTitle('')
    setDescription('')
    setDocumentType('other')
    setMaxFiles(1)
    setNotice('Document request sent to the client.')
    await load()
  }

  async function cancelRequest(id: string) {
    if (busy) return
    if (!window.confirm('Cancel this document request?')) return

    setBusy(true)
    setError('')
    setNotice('')

    const { error: cancelError } = await supabase.rpc(
      'cancel_document_request',
      { p_document_request_id: id },
    )

    setBusy(false)

    if (cancelError) {
      setError(cancelError.message)
      return
    }

    setNotice('Document request cancelled.')
    await load()
  }

  const clientName = client
    ? `${client.first_name} ${client.last_name}`
    : 'Client'

  return (
    <ApplicationWorkspaceShell clientId={clientId} section="documents">
      <header className="applicationHeader">
        <div>
          <p className="eyebrow">DOCUMENT RELAY</p>
          <h1>{clientName} · Document requests</h1>
          <p className="muted">Choose an application to request and track documents for this client.</p>
        </div>
        <div className="systemOfRecord">
          No permanent mortgage document repository
        </div>
      </header>

      <WorkspaceClientPicker clientId={clientId} route={id => `/documents/${id}`} label="Request for client" />
      {error && <div className="notice error">{error}
        {error.includes('Document Delivery Email') && <p>
          The Head Broker can <Link href="/admin/document-delivery">verify the company document delivery email</Link>.
        </p>}
      </div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">NEW REQUEST</p>
        <h2>Ask the client for a document</h2>
        <p className="muted">
          The client can upload the requested file. It is sent to the verified
          document delivery email and purged from temporary relay storage.
        </p>

        <div className="applicationForm">
          <label>
            Related application
            <select
              value={applicationId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setApplicationId(event.target.value)
              }
            >
              <option value="">Select a loan application…</option>
              {applications.map((application) => (
                <option key={application.id} value={application.id}>
                  {application.application_reference ?? 'Legacy application'}
                  {application.application_description
                    ? ` · ${application.application_description}`
                    : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Document type
            <select
              value={documentType}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setDocumentType(event.target.value)
              }
            >
              <option value="identity">Identity</option>
              <option value="income">Income / payslip</option>
              <option value="bank_statement">Bank statement</option>
              <option value="loan_statement">Loan statement</option>
              <option value="rates_notice">Rates notice</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label>
            Request title
            <input
              maxLength={120}
              value={title}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setTitle(event.target.value)
              }
              placeholder="e.g. Latest two payslips"
            />
          </label>

          <label>
            Instructions for client
            <textarea
              rows={4}
              maxLength={1500}
              value={description}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setDescription(event.target.value)
              }
              placeholder="Optional instructions"
            />
          </label>

          <label>
            Maximum files
            <select
              value={maxFiles}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setMaxFiles(Number(event.target.value))
              }
            >
              {[1, 2, 3, 4, 5].map((count) => (
                <option value={count} key={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={createRequest}
            disabled={busy || !title.trim() || !applicationId}
          >
            {busy ? 'Sending…' : 'Send document request'}
          </button>
        </div>
      </section>

      <section className="card">
        <p className="eyebrow">REQUEST HISTORY</p>
        <h2>{requests.length} request{requests.length === 1 ? '' : 's'}</h2>

        {requests.length === 0 ? (
          <p className="muted">No document requests yet.</p>
        ) : (
          <div className="statusHistory">
            {requests.map((request) => (
              <div className="historyItem" key={request.document_request_id}>
                <div className="historyDot" />
                <div style={{ width: '100%' }}>
                  <div className="sectionHead">
                    <div>
                      <strong>{request.title}</strong>
                      <div className="muted smallText">
                        {new Date(request.requested_at).toLocaleString()}
                        {request.application_number
                          ? ` · Application ${request.application_number}`
                          : ''}
                      </div>
                    </div>
                    <span className="systemOfRecord">
                      {statusLabel[request.status] ?? request.status}
                    </span>
                  </div>

                  {request.description && <p>{request.description}</p>}

                  {['requested', 'failed'].includes(request.status) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        cancelRequest(request.document_request_id)
                      }
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </ApplicationWorkspaceShell>
  )
}
