# Compact partner dashboard

Upload the extracted folders to the root of the development branch, replacing existing files, then deploy Netlify. No SQL, environment settings or backend deployment is needed.

Dashboard: four summary cards and two panels for sending invitations and browsing companies/invitations. Lists have search, invitation status filters and ten rows per page. Commissions and Transfers are separate navigation views. Sandbox commission results are collapsed within Commissions. The panels stack on narrower screens.

Existing invitation creation, attribution, resend permission, agreement gating and transfer actions are preserved. This changes presentation only; automatic collection and commission payouts are not enabled.

Validation: Next.js production build and TypeScript passed. Verify signed-in partner layout, invitation submission, search/pagination and mobile display after deploying.
