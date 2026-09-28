'use client'

import Link from 'next/link'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

const sections = [
  ['start', 'Getting started'], ['clients', 'Clients & service team'],
  ['messages', 'Messages'], ['applications', 'Applications'],
  ['documents', 'Document requests'], ['announcements', 'Announcements'],
  ['follow-ups', 'Follow-up messages'], ['company', 'Company & staff'],
  ['mobile-appearance', 'Mobile app appearance'],
  ['support', 'Help with a problem'],
] as const

export default function HelpPage() {
  return <ApplicationWorkspaceShell section="help">
    <header className="applicationHeader"><div>
      <p className="eyebrow">BROKERRELAY GUIDE</p>
      <h1>Help &amp; Support</h1>
      <p className="muted helpIntro">A practical guide for brokers, Head Brokers and company staff. Use the left menu to move between workspaces without returning to the dashboard.</p>
    </div></header>
    <nav className="helpContents" aria-label="Help topics">
      {sections.map(([id, title]) => <a key={id} href={`#${id}`}>{title}</a>)}
    </nav>
    <div className="helpSections">
      <section className="card" id="start"><p className="eyebrow">01 · WORKSPACE</p><h2>Getting started</h2>
        <ol><li>Sign in with the account invited by your company. If you received a staff invitation, accept it before opening the Broker Desk.</li>
          <li>Use <Link href="/dashboard">Home</Link> to see your connected clients, invitation tools and account menu. Use your account menu to sign out.</li>
          <li>Select Messages, Applications, Document requests or Manage team from the left menu. Choose a client inside that workspace. Access depends on your company role and client assignment.</li></ol>
        <p className="muted">A client joins through a mobile invitation or the browser invitation test page. They may need to accept and connect before you can work on their loan.</p>
      </section>
      <section className="card" id="clients"><p className="eyebrow">02 · CLIENTS</p><h2>Clients &amp; service team</h2>
        <ol><li>On <Link href="/dashboard#clients">Home → Connected clients</Link>, search for a client and select their name to expand the profile in place.</li>
          <li>Use the profile actions to open messages, applications, document requests or the service team.</li>
          <li>In <Link href="/clients/team">Manage team</Link>, choose a client. The Head Broker can change the primary broker; authorised staff can assign or remove broker assistants.</li></ol>
        <p className="muted">Only staff assigned to a client should be able to view that client’s applications, messages and documents. Ask your Head Broker to check assignments if a client is missing.</p>
      </section>
      <section className="card" id="messages"><p className="eyebrow">03 · COMMUNICATION</p><h2>Secure messages</h2>
        <ol><li>Open <Link href="/messages">Messages</Link> and select the client. You can change clients with the selector at the top of the conversation.</li>
          <li>Write your message and choose <strong>Send secure message</strong>. New replies appear in the conversation; opening it marks messages as read.</li></ol>
        <p className="muted">Messages support text. Use Document requests when you need a file; avoid asking clients to attach sensitive documents in a message.</p>
      </section>
      <section className="card" id="applications"><p className="eyebrow">04 · LOAN PROGRESS</p><h2>Applications</h2>
        <ol><li>Open <Link href="/applications">Applications</Link>, choose a client, and select the active application. Its details and progress controls appear below.</li>
          <li>Create a separate application when the client has another loan. Enter the application number used by your CRM or lender and a clear client-friendly description. Keep the number accurate; the description can be updated later.</li>
          <li>Use <strong>Publish status</strong> to update progress. Add a client-facing note when helpful. Conditional approval, full approval and settlement changes can create client notifications.</li>
          <li>For a lender-requested replacement, use <strong>Replacement</strong>. This withdraws the old application and creates a new one with its own number. Use <strong>Archive / Past</strong> to review withdrawn or older settled applications.</li></ol>
        <p className="muted">For a settled loan, enter the settlement date. BrokerRelay schedules its follow-ups from that date and moves the application to Past after 90 days. Check the application status before sending a manual loan follow-up.</p>
      </section>
      <section className="card" id="documents"><p className="eyebrow">05 · DOCUMENT RELAY</p><h2>Document requests</h2>
        <ol><li>Open <Link href="/documents">Document requests</Link> and choose the client.</li>
          <li>Select the related loan application, document type, request title, optional instructions and the maximum number of files.</li>
          <li>Choose <strong>Send document request</strong>. Review its status in Request history; a pending or failed request can be cancelled.</li></ol>
        <p className="muted">Before the first request, the Head Broker opens <Link href="/admin/document-delivery">Delivery settings</Link> from the left menu, enters the company’s receiving mailbox and verifies it with the email code. Uploaded files are relayed to that verified mailbox and removed from temporary storage according to the relay workflow. The requesting broker also receives a private copy at their confirmed sign-in email while their broker and company memberships remain active. To copy other people or another mailbox, set up forwarding with your email provider. Confirm delivery before relying on a file.</p>
      </section>
      <section className="card" id="announcements"><p className="eyebrow">06 · CLIENT UPDATES</p><h2>Announcements</h2>
        <ol><li>Open <Link href="/announcements">Announcements</Link>. Choose My clients or, if authorised, Company clients. You may narrow recipients by lender or select particular clients.</li>
          <li>Write a title and message, or load a saved company message. Birthday and New Year messages are examples of manual messages; choose recipients and send each one yourself.</li>
          <li>For a loan follow-up, choose one client and their application. Only messages matching that application’s current status appear. Review the message and recipients before sending.</li>
          <li>Use <strong>Recent announcements</strong> to review sends and read counts. The recipient audience is checked again when sending.</li></ol>
        <p className="muted">A manually sent loan follow-up is linked to its application. Sending it does not change the application status or replace scheduled notifications.</p>
      </section>
      <section className="card" id="follow-ups"><p className="eyebrow">07 · MESSAGE SETTINGS</p><h2>Follow-up messages</h2>
        <ol><li>In <Link href="/settings/follow-up-templates">Follow-up settings</Link>, review the default approval, settlement and post-settlement messages. Edit the title or body and save your broker wording, or restore the company/platform wording.</li>
          <li>Use <code>{'{{client_first_name}}'}</code>, <code>{'{{broker_first_name}}'}</code> and <code>{'{{application_description}}'}</code> where appropriate. They are filled when notifications are created.</li>
          <li>A Head Broker can add, edit or delete reusable company messages in the Company message library. Brokers can then choose them while writing an announcement.</li></ol>
        <p className="muted">Saved company messages are manual templates. They do not create birthday reminders or automatic holiday broadcasts. Automatic loan milestones follow application status and settlement date.</p>
      </section>
      <section className="card" id="company"><p className="eyebrow">08 · COMPANY ADMINISTRATION</p><h2>Company &amp; staff</h2>
        <ol><li>Authorised company staff can open <Link href="/admin">Company &amp; staff</Link> to update the company profile and logo, invite staff, and review pending invitations.</li>
          <li>Assign roles and permissions deliberately. Review client assignments when changing a broker’s responsibilities.</li>
          <li>Transfer a departing broker’s clients before deactivating their access. A Head Broker can start a protected handover that requires confirmation by both people.</li></ol>
        <p className="muted">Some controls appear only for the Head Broker or staff with the relevant permission.</p>
      </section>
      <section className="card" id="mobile-appearance"><p className="eyebrow">09 · COMPANY BRANDING</p><h2>Mobile app appearance</h2>
        <ol><li>The Head Broker opens <Link href="/settings/mobile-appearance">Mobile appearance</Link> from the left menu or Company &amp; staff. This setting controls how the company appears inside the client app.</li>
          <li>Upload an optional company logo (PNG, JPEG or WebP, up to 2 MB), or use the standard business icon. The phone preview shows the selected logo.</li>
          <li>Choose the BrokerRelay defaults or customise <strong>Background</strong>, <strong>Background text</strong>, <strong>Buttons</strong> and <strong>Notifications</strong>. For a dark background, select a light background text colour. Check the phone preview as you make changes.</li>
          <li>Choose <strong>Publish changes</strong> when the colours are readable. Clients see the published appearance after their app refreshes.</li></ol>
        <p className="muted">The installed app icon remains BrokerRelay. Button and notification label colours adjust automatically; the background text colour controls headings and labels over the page background.</p>
      </section>
      <section className="card" id="support"><p className="eyebrow">10 · TROUBLESHOOTING</p><h2>Help with a problem</h2>
        <h3>Client or application missing</h3><p>Check that you selected the correct client and that your Head Broker assigned you to their service team. For a withdrawn or older settled loan, check Archive / Past.</p>
        <h3>Document request cannot be completed</h3><p>Ask the Head Broker to open Delivery settings in the left menu and verify the company’s document delivery email. Check the request status before asking the client to upload again.</p>
        <h3>Follow-up option missing</h3><p>Choose one client and application first. Only messages allowed for that loan status are offered. Approval and settlement defaults also require the follow-up database update.</p>
        <h3>Mobile appearance cannot be published</h3><p>Only the Head Broker can edit it. Choose a valid background text colour with enough contrast against the background; the page shows an alert if the combination is difficult to read. If the Background text option is missing or saving fails, ask your administrator to check that the latest web update and mobile appearance database update have been installed.</p>
        <h3>Sign-in or access problem</h3><p>Check that you are using the invited email address. Existing clients can reset their password from the invitation page; signed-in users can <Link href="/account/password">change their password</Link>. If access is still missing, contact your company’s Head Broker or administrator with the page name and error message. Do not send passwords or client documents in a support request.</p>
      </section>
    </div>
  </ApplicationWorkspaceShell>
}
