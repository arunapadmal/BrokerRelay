'use client'

import Link from 'next/link'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

const sections = [
  ['start', 'Getting started'], ['clients', 'Clients & service team'],
  ['messages', 'Messages'], ['applications', 'Applications'],
  ['documents', 'Document requests'], ['announcements', 'Announcements'],
  ['follow-ups', 'Follow-up messages'], ['company', 'Company & staff'],
  ['mobile-appearance', 'Mobile app appearance'], ['billing', 'Billing & invoices'],
  ['payments', 'Direct debit & receipts'], ['support', 'Help with a problem'],
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
        <p>Home now includes <strong>Your next actions</strong>: unread conversations, open document requests and applications in progress. Head Brokers can expand the company setup checklist. These counts cover records you are permitted to access.</p>
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
        <p>Use secure messages for a conversation, application updates for loan progress, and announcements for eligible client updates. Notifications alert clients to new activity; they are not a separate conversation.</p>
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
        <p className="muted">Before the first request, the Head Broker opens <Link href="/admin/document-delivery">Delivery settings</Link> from the left menu, enters the company’s single receiving mailbox and verifies it with the email code. To change a saved address, choose Edit email, enter a different address and verify it. Saving the same address again is prevented; existing requests retain their original destination. Uploaded files are relayed to that verified mailbox and removed from temporary storage according to the relay workflow. The requesting broker also receives a private copy at their confirmed sign-in email while their broker and company memberships remain active. To copy other people or another mailbox, set up forwarding with your email provider. Confirm delivery before relying on a file.</p>
      </section>
      <section className="card" id="announcements"><p className="eyebrow">06 · CLIENT UPDATES</p><h2>Announcements</h2>
        <ol><li>Open <Link href="/announcements">Announcements</Link>. Choose My clients or, if authorised, Company clients. You may narrow recipients by lender or select particular clients.</li>
          <li>General announcements require an active company subscription and a recorded settled application for each recipient. Clients without a settled application can receive loan milestone announcements for their application status. Write a title and message, or load a saved company message. Birthday and New Year messages can be sent manually or scheduled in Follow-up Message Settings.</li>
          <li>For a loan follow-up, choose one client and their application. Only messages matching that application’s current status appear. Review the message and recipients before sending.</li>
          <li>Use <strong>Recent announcements</strong> to review sends and read counts. The recipient audience is checked again when sending.</li></ol>
        <p className="muted">A manually sent loan follow-up is linked to its application. Sending it does not change the application status or replace scheduled notifications.</p>
      </section>
      <section className="card" id="follow-ups"><p className="eyebrow">07 · MESSAGE SETTINGS</p><h2>Follow-up messages and company schedules</h2>
        <h3>Loan follow-ups</h3>
        <p>Open <Link href="/settings/follow-up-templates">Follow-up Message Settings</Link> and select <strong>Loan follow-ups</strong>. Review the approval, settlement and review messages. Save your broker wording or restore company/platform wording. Loan milestones follow the application status; later reviews follow its settlement date.</p>
        <p>Use <code>{'{{client_first_name}}'}</code> and <code>{'{{broker_first_name}}'}</code> to personalise greetings. Loan messages can also use <code>{'{{application_description}}'}</code>.</p>
        <h3>Set up company-message scheduling</h3>
        <ol>
          <li>The Head Broker opens <Link href="/admin">Company &amp; Staff</Link>, selects an active broker, enables <strong>Can schedule company messages</strong> and saves. Company-wide sending requires its separate announcement permission.</li>
          <li>Open <Link href="/settings/follow-up-templates">Follow-up Message Settings</Link> → <strong>Company messages</strong>. The Head Broker can create shared templates, such as New Year greetings or birthday wishes. Saving a template alone does not schedule a send.</li>
          <li>Select a saved message and choose <strong>Send once</strong>, <strong>Every year</strong> or <strong>Every client birthday</strong>. Choose the send time and timezone. One-off and annual messages also need a date.</li>
          <li>Choose <strong>My assigned clients</strong>, specific clients, or <strong>All company clients</strong> if authorised. Each broker manages their own client schedules; the Head Broker can oversee all company schedules.</li>
          <li>Save the schedule. New schedules start <strong>Paused</strong>. Choose <strong>Preview recipients</strong> and review the occurrence date, message and any eligibility blocks. For birthdays, select the birthday date to preview that day’s recipients.</li>
          <li>Choose <strong>Activate</strong> and confirm the saved schedule shows <strong>Active</strong>. Saving and activating are separate steps. Pause a schedule before editing if you want to review it again before sending.</li>
        </ol>
        <h3>Optional birthdays and greeting preferences</h3>
        <p>Expand a client’s profile on the <Link href="/dashboard">Dashboard</Link> and open <strong>Optional birthday and greetings</strong>. Enter only day and month; a birth year is not required. Birthday information is optional and never blocks registration or a loan application.</p>
        <p>With the client’s agreement, select <strong>Client agrees to birthday greetings</strong> and/or <strong>Client agrees to general company greetings</strong>, then choose <strong>Save preferences</strong>. Recording a birthday alone does not enable greetings. New Year greetings require the general company-greetings preference.</p>
        <p>Once the birthday schedule is active, newly recorded birthdays are included automatically when eligible. Clients without a birthday are omitted. February 29 birthdays use February 28 in non-leap years. In the updated client app, clients can manage these choices under <strong>Settings and more → Birthday and greetings</strong>.</p>
        <h3>When and where messages arrive</h3>
        <p>Automatic sending runs on the server every five minutes, so an eligible message normally appears within about five minutes after its selected time. Times follow the schedule’s timezone, such as Australia/Melbourne. Sending continues when the browser is closed and does not require BrokerRelay Pro to be installed or open.</p>
        <p>Scheduled greetings appear in the client app’s <strong>Announcements</strong> and in-app notifications. This scheduling feature does not send email or push notifications. Before each send, BrokerRelay checks current client assignments, broker permissions, greeting preferences, an active eligible subscription and a recorded billable settled application.</p>
        <h3>Check delivery or troubleshoot a skipped message</h3>
        <ol>
          <li>Check the schedule is Active, its date/time/timezone are correct, and the client is in its current audience.</li>
          <li>Review <strong>Daily tasks and recipient preview</strong> and <strong>Recent delivery history</strong> in company-message scheduling, also available through Announcements.</li>
          <li><strong>Scheduled</strong> means due to send; <strong>Blocked</strong> means a current eligibility check prevents sending; <strong>Sent</strong> means the in-app message was created, not that the client has read it; <strong>Skipped</strong> records an occurrence that was not sent; <strong>Failed</strong> needs investigation.</li>
          <li>If the reason is <strong>Company greetings are disabled</strong>, check the client’s general company-greetings preference. Enable it only with their agreement. For birthday messages, check both the birthday and birthday-greetings preference.</li>
          <li>For billing blocks, contact the Head Broker to check the subscription and settled-loan eligibility. For assignment or permission blocks, review Company &amp; Staff and the client’s service team.</li>
          <li>A skipped occurrence does not retry automatically after preferences or billing change. Correct the cause and create a new future one-off schedule if another send is appropriate. Overlapping birthday schedules or the same template for the same client/date may be skipped to prevent duplicate greetings.</li>
          <li>If an eligible active message still has no delivery record after the expected run, contact the Platform Owner with the schedule name, selected time, timezone and displayed error. Avoid sending it manually until you confirm whether an automatic delivery already exists.</li>
        </ol>
        <h3>BrokerRelay Pro daily tasks</h3>
        <p>In the updated BrokerRelay Pro app, <strong>My Day</strong> shows today’s scheduled greetings, client, sending broker and delivery status. Pull down to refresh. Open a card to review the message or manage its schedule in BrokerDesk. Opening a task does not resend it. Pro displays the tasks; the server performs the automatic sending.</p>
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
      <section className="card" id="billing"><p className="eyebrow">10 · COMPANY SUBSCRIPTION</p><h2>Billing &amp; invoices</h2>
        <p>The Head Broker opens <Link href="/billing">Billing &amp; invoices</Link> from the left menu or Company &amp; staff. Other brokers should contact their Head Broker about company billing.</p>
        <h3>Check your package and usage</h3>
        <ol><li>Review your current package, monthly price, included settlements and extra settlement rate. Use the amounts displayed for your company; package prices and allowances can change for future months.</li>
          <li>Check the settlements used and estimated usage bill. The estimate excludes GST and one-time fees; the final invoice includes any applicable charges.</li>
          <li>Ask the Platform Owner to change your package. Existing-company package changes start next month; a scheduled change appears on the billing page.</li></ol>
        <p>Allowances reset on the first of each calendar month in Melbourne time and do not roll over. Each application counts once when settlement is first recorded. Keep the application number and settlement date accurate, and publish Settled when the loan settles.</p>
        <p className="muted">The included allowance is not a limit on processing loans. Further settlements use the extra settlement rate for that billing month. Company setup includes the Head Broker. Any configured additional broker activation fee applies to a new broker; existing staff and reactivation of the same account are not charged again.</p>
        <h3>Monthly invoice timeline</h3>
        <ol><li><strong>During the month:</strong> view your usage and estimated bill. A new subscription starts at the full calendar-month price.</li>
          <li><strong>On the 1st:</strong> an invoice for the previous calendar month appears after billing runs. When email delivery is enabled, it is sent to your company billing email.</li>
          <li><strong>After invoice notice:</strong> authorised automatic collection is scheduled seven days after notice. If notice is delayed, collection is delayed too.</li>
          <li><strong>After confirmed payment:</strong> the invoice is marked paid. When receipt delivery is enabled, a receipt goes to the company billing email.</li></ol>
        <h3>Read or save an invoice</h3>
        <ol><li>Select <strong>Refresh invoices</strong>, then choose the invoice for the month you need.</li>
          <li>Review the subscription, extra settlements, applicable one-time fees, subtotal, 10% GST and total. Prices displayed for packages and extra settlements exclude GST.</li>
          <li>Review the settlement records for application numbers and the broker who recorded each settlement. Issued invoice details are preserved if later company details or prices change.</li>
          <li>Use the invoice print option and your browser’s Save as PDF destination to keep a copy. For manual payment, follow the invoice instructions and use the requested reference.</li></ol>
        <p className="muted">The first final invoice appears after your first billing month ends. An empty invoice list during that month is expected. Earlier issued invoices retain their original amounts; do not assume GST has been added retrospectively.</p>
        <h3>Subscription status and communication</h3>
        <p>General announcements and post-settlement relationship follow-ups require an active subscription, including any approved overdue grace period. General announcements also require a recorded settled application for each recipient. Before settlement, use loan-processing communications and status-eligible milestone announcements. If relationship communications are paused, ask your Head Broker to review billing with the Platform Owner.</p>
      </section>
      <section className="card" id="payments"><p className="eyebrow">11 · PAYMENTS</p><h2>Direct debit &amp; receipts</h2>
        <p>Automatic payments are available only after the Platform Owner configures the payment gateway and billing delivery. A company’s Head Broker must authorise collection from their own billing page.</p>
        <ol><li>Open <Link href="/billing">Billing &amp; invoices</Link> and find <strong>Automatic direct debit</strong>.</li>
          <li>Select <strong>Set up direct debit</strong>, or <strong>Update debit authorisation</strong> for an existing authorisation. Enter the required details in the secure Stripe form.</li>
          <li>Read the authorisation, select its consent checkbox, then choose <strong>Authorise direct debit</strong>.</li>
          <li>Select <strong>Refresh payment status</strong> after submission. Confirmation may take a moment. An authorised live account shows its last four digits; a test authorisation does not enable real invoice collection.</li></ol>
        <p>Collection is scheduled seven days after the invoice notice and may take time to complete. A submitted or processing debit is not yet a paid invoice. Receipts are sent after successful payment is confirmed.</p>
        <p>New or changed bank authorisations apply to future invoice notices. An existing invoice may need manual payment; ask the Platform Owner before paying it another way if a debit may already be processing.</p>
        <h3>Stop future automatic payments</h3>
        <p>Select <strong>Stop automatic payments</strong> and confirm. A payment already submitted may still complete. Stopping collection does not cancel your subscription or remove amounts owed; arrange an alternative payment method with the Platform Owner.</p>
        <p className="muted">Stripe collects bank details securely. BrokerRelay stores the authorisation reference and last four digits. Never send full bank details or passwords in a support message.</p>
      </section>
      <section className="card" id="support"><p className="eyebrow">12 · TROUBLESHOOTING</p><h2>Help with a problem</h2>
        <h3>No invoice or billing access</h3><p>Billing is available to the Head Broker. Check that a subscription has been assigned and that the first billing month has ended, then choose Refresh invoices. If a completed month is missing, ask the Platform Owner to check the billing run.</p>
        <h3>Invoice or receipt email missing</h3><p>Ask the Head Broker to check the company billing email in Company &amp; staff and review the spam folder. The invoice may still be available on the billing page. Give the Platform Owner the invoice number so they can check delivery. A receipt is not due while payment is still processing.</p>
        <h3>Direct debit unavailable or payment failed</h3><p>If setup is unavailable, ask the Platform Owner to check gateway configuration. A test authorisation cannot collect real invoices. For a failed payment, review the notice, refresh payment status and contact the Platform Owner about updating the authorisation or paying manually. Do not repeatedly submit payment while its status is uncertain.</p>
        <h3>Settlement count or invoice looks incorrect</h3><p>Note the billing month, invoice number and application number. Compare the settlement records with your applications, then ask the Platform Owner to investigate. Changing a settled application does not automatically reverse an issued invoice.</p>
        <h3>Company performance</h3><p>Home shows client and application totals with current status breakdowns. Head Brokers see their company totals; other brokers see records they can access. Select All time for totals and current status breakdowns, or This month for new client records, newly created applications and settlements dated in the current Melbourne calendar month. Monthly settlements include older applications settled this month. Settled loans without a settlement date are excluded from the monthly settlement count. These performance totals are different from billable usage on invoices: billing counts when settlement is first recorded, while performance uses the actual settlement date.</p>
        <h3>Dashboard action counts</h3><p>Unread conversations count clients with unread replies. Open document requests include requests awaiting upload and failed delivery. Applications in progress are a worklist, not an overdue warning. Refresh Home after completing work. Head Brokers can expand the company setup checklist for links to company details, delivery, appearance, templates and billing.</p>
        <h3>Client or application missing</h3><p>Check that you selected the correct client and that your Head Broker assigned you to their service team. For a withdrawn or older settled loan, check Archive / Past.</p>
        <h3>Document request cannot be completed</h3><p>Ask the Head Broker to open Delivery settings in the left menu and verify the company’s document delivery email. Check the request status before asking the client to upload again.</p>
        <h3>Follow-up option missing</h3><p>Ask the Head Broker to check the company subscription if a billing restriction appears. Choose one client and application first. Only messages allowed for that loan status are offered. Approval and settlement defaults also require the follow-up database update.</p>
        <h3>Mobile appearance cannot be published</h3><p>Only the Head Broker can edit it. Choose a valid background text colour with enough contrast against the background; the page shows an alert if the combination is difficult to read. If the Background text option is missing or saving fails, ask your administrator to check that the latest web update and mobile appearance database update have been installed.</p>
        <h3>Sign-in or access problem</h3><p>Check that you are using the invited email address. Existing clients can reset their password from the invitation page; signed-in users can <Link href="/account/password">change their password</Link>. If access is still missing, contact your company’s Head Broker or administrator with the page name and error message. Do not send passwords or client documents in a support request.</p>
      </section>
    </div>
  </ApplicationWorkspaceShell>
}
