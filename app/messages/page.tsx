'use client'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'
export default function MessagesWorkspace() {
  return <ApplicationWorkspaceShell section="messages"><header className="applicationHeader"><div><p className="eyebrow">SECURE MESSAGES</p><h1>Messages</h1><p className="muted">Select a client to open their conversation.</p></div></header><section className="card workspaceSelection"><WorkspaceClientPicker route={id => `/messages/${id}`} /></section></ApplicationWorkspaceShell>
}
