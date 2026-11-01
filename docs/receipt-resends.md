# Sandbox receipt copies

The development database and billing-sandbox-actions function have already been updated. Upload the extracted files to the root of the development branch and deploy Netlify. Do not rerun the SQL on Development.

After an original test receipt has been accepted by the email provider, its button changes to Resend receipt to me. Each deliberate resend is recorded in Receipt email history, with the recipient, time and provider acceptance status. Provider acceptance does not guarantee inbox delivery.

Only the signed-in, verified Platform Owner can receive copies. Copies do not create payments, receipts or commissions. Automatic receipt delivery remains once per payment. There is a one-minute pause and a maximum of ten requested copies per invoice in 24 hours.

An uncertain provider response remains pending. Clicking again resumes that same request with its original content and idempotency key. Requests older than twenty hours require review to avoid sending again after provider deduplication expires.

Validation: production build; transaction-rolled-back SQL checks for repeated pending requests, resend cooldown and service-only execution. End-to-end resend delivery must be checked after the UI deployment. Live billing and other environments are unchanged.
