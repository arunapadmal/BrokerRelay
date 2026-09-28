'use client'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'
export default function TeamWorkspace() {
  return <ApplicationWorkspaceShell section="team"><header className="applicationHeader"><div><p className="eyebrow">CLIENT ACCESS</p><h1>Manage service team</h1><p className="muted">Choose the client whose broker and assistant assignments you want to manage.</p></div></header><section className="card workspaceSelection"><WorkspaceClientPicker route={id => `/clients/${id}/team`} /></section></ApplicationWorkspaceShell>
}
