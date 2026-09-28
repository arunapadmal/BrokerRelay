'use client'

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'

type Client = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile: string | null
}

type Message = {
  id: string
  sender_user_id: string
  body: string
  created_at: string
}

export default function MessagePage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params.clientId
  const [client, setClient] = useState<Client | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [composer, setComposer] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  async function markRead(id: string) {
    await supabase.rpc('mark_conversation_read', { p_conversation_id: id })
  }

  async function loadMessages(id: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('id,sender_user_id,body,created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    if (error) throw error
    setMessages((data ?? []) as Message[])
    await markRead(id)
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        window.location.href = '/login'
        return
      }
      setCurrentUserId(authData.user.id)

      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('id,first_name,last_name,email,mobile')
        .eq('id', clientId)
        .single()
      if (clientError) throw clientError
      setClient(clientData as Client)

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('id')
        .eq('client_id', clientId)
        .maybeSingle()
      if (conversationError) throw conversationError

      if (conversation?.id) {
        setConversationId(conversation.id)
        await loadMessages(conversation.id)
      } else {
        setConversationId(null)
        setMessages([])
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load secure messages.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [clientId])

  useEffect(() => {
    const channel = supabase
      .channel(`messages-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `client_id=eq.${clientId}`,
        },
        async (payload: any) => {
          const next = payload.new as Message
          setMessages((prev: Message[]) => prev.some((m: Message) => m.id === next.id) ? prev : [...prev, next])
          if (conversationId) await markRead(conversationId)
        },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [clientId, conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = composer.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const { data, error } = await supabase.rpc('send_message', {
        p_client_id: clientId,
        p_body: body,
      })
      if (error) throw error
      setComposer('')

      const first = Array.isArray(data) ? data[0] : data
      const id = first?.conversation_id as string | undefined
      if (id) {
        if (!conversationId) setConversationId(id)
        await loadMessages(id)
      } else {
        await load()
      }
    } catch (e: any) {
      setError(e?.message ?? 'Unable to send message.')
    } finally {
      setSending(false)
    }
  }

  const clientName = client ? `${client.first_name} ${client.last_name}` : 'Client'

  return (
    <ApplicationWorkspaceShell clientId={clientId} section="messages">
      <div className="messagePage">
      <WorkspaceClientPicker clientId={clientId} route={id => `/messages/${id}`} />
      <header className="messageHeader">
        <div>
          <p className="eyebrow">SECURE MESSAGES</p>
          <h1>{clientName}</h1>
          {client && <p className="muted">{client.email ?? ''}{client.mobile ? ` · ${client.mobile}` : ''}</p>}
        </div>
        <div className="secureLabel">🔒 Tenant-isolated</div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="chatCard">
        <div className="chatMessages">
          {loading ? (
            <p className="muted">Loading secure conversation…</p>
          ) : messages.length === 0 ? (
            <div className="emptyChat">
              <strong>No messages yet</strong>
              <p className="muted">Send the first secure message to {clientName}.</p>
            </div>
          ) : (
            messages.map((m: Message) => {
              const mine = m.sender_user_id === currentUserId
              return (
                <div key={m.id} className={`messageRow ${mine ? 'mine' : 'theirs'}`}>
                  <div className="messageBubble">
                    <div>{m.body}</div>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form className="messageComposer" onSubmit={send}>
          <textarea
            value={composer}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setComposer(e.target.value)}
            placeholder={`Message ${client?.first_name ?? 'client'}…`}
            maxLength={4000}
            rows={3}
          />
          <div className="composerFoot">
            <span>{composer.length}/4000 · Text only</span>
            <button disabled={sending || !composer.trim()}>{sending ? 'Sending…' : 'Send secure message'}</button>
          </div>
        </form>
      </section>
      </div>
    </ApplicationWorkspaceShell>
  )
}
