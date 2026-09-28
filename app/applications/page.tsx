'use client'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'
export default function ApplicationsWorkspace() {
  return <ApplicationWorkspaceShell section="active"><header className="applicationHeader"><div><p className="eyebrow">BROKER WORKSPACE</p><h1>Applications</h1><p className="muted">Select a client to manage their active loan applications.</p></div></header><section className="card workspaceSelection"><WorkspaceClientPicker route={id => `/applications/${id}`} /></section></ApplicationWorkspaceShell>
}
