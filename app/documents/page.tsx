'use client'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'
import { WorkspaceClientPicker } from '@/components/WorkspaceClientPicker'
export default function DocumentsWorkspace() {
  return <ApplicationWorkspaceShell section="documents"><header className="applicationHeader"><div><p className="eyebrow">DOCUMENT RELAY</p><h1>Document requests</h1><p className="muted">Choose the client first, then choose the loan application when creating a request.</p></div></header><section className="card workspaceSelection"><WorkspaceClientPicker route={id => `/documents/${id}`} /><p className="muted">The request form and history for your selected client will open here.</p></section></ApplicationWorkspaceShell>
}
