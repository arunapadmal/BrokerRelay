'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

type Application = {
  id: string
  application_reference: string | null
  application_description: string | null
  status: string
}

export default function ReplacementApplicationToolsPage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params.clientId

  const [apps, setApps] = useState<Application[]>([])
  const [sourceId, setSourceId] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [description, setDescription] = useState('')
  const [note, setNote] = useState(
    'Lender requested a replacement application.',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const source = useMemo(
    () => apps.find((row) => row.id === sourceId) ?? null,
    [apps, sourceId],
  )

  async function load() {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    const { data, error: loadError } = await supabase
      .from('loan_applications')
      .select('id,application_reference,application_description,status')
      .eq('client_id', clientId)
      .not('status', 'in', '(settled,withdrawn)')
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      return
    }

    const rows = (data ?? []) as Application[]
    setApps(rows)
    setSourceId((current) => current || rows[0]?.id || '')
  }

  useEffect(() => {
    void load()
  }, [clientId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!source || busy) return

    if (!newNumber.trim()) {
      setError('New application number is required.')
      return
    }

    if (
      apps.some(
        (row) =>
          row.application_reference?.trim().toLowerCase() ===
          newNumber.trim().toLowerCase(),
      )
    ) {
      setError(
        `Application number "${newNumber.trim()}" is already in use. Enter the new CRM/lender application number.`,
      )
      return
    }

    if (
      !window.confirm(
        `Withdraw ${source.application_reference ?? 'the selected application'} and create replacement ${newNumber.trim()}?`,
      )
    ) {
      return
    }

    setBusy(true)
    setError('')

    const { error: replaceError } = await supabase.rpc(
      'withdraw_and_create_replacement_application',
      {
        p_application_id: source.id,
        p_new_application_reference: newNumber.trim(),
        p_new_application_description: description.trim() || null,
        p_withdrawal_note:
          note.trim() || 'Lender requested a replacement application.',
      },
    )

    setBusy(false)

    if (replaceError) {
      setError(replaceError.message)
      return
    }

    window.location.href = `/applications/${clientId}`
  }

  return (
    <ApplicationWorkspaceShell clientId={clientId} section="replacement">
      <header className="applicationHeader">
        <div>
          <p className="eyebrow">APPLICATION TOOLS</p>
          <h1>Replacement application</h1>
          <p className="muted">
            Use this only when a lender requires a completely new application.
            It is intentionally kept outside the normal status workflow.
          </p>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="card applicationCreateCard">
        <form onSubmit={submit} className="applicationForm">
          <label>
            Application being replaced
            <select
              required
              value={sourceId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setSourceId(event.target.value)
              }
            >
              {apps.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.application_reference ?? 'Missing application number'}
                  {row.application_description
                    ? ` — ${row.application_description}`
                    : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            New application number <strong>(required)</strong>
            <input
              required
              value={newNumber}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setNewNumber(event.target.value)
              }
              placeholder="e.g. AOL05"
            />
            <span className="muted smallText">
              Enter the new CRM/lender application number. It becomes locked once
              the replacement application is created.
            </span>
          </label>

          <label>
            Client-friendly description
            <input
              maxLength={160}
              value={description}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDescription(event.target.value)
              }
              placeholder="e.g. Home Purchase – 12 Smith Street"
            />
          </label>

          <label>
            Withdrawal note
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setNote(event.target.value)
              }
            />
          </label>

          <button disabled={busy || apps.length === 0}>
            {busy ? 'Creating replacement…' : 'Withdraw & create replacement'}
          </button>
        </form>
      </section>
    </ApplicationWorkspaceShell>
  )
}
