# Partner amended-offer acceptance

Upload the extracted folders to the root of development and deploy Netlify. The Development database function is already installed; do not rerun SQL there.

Existing verified partners keep their current password when accepting an amended offer. Signed-in account verification plus the three explicit agreement acknowledgements confirm acceptance; no additional password change is performed. First-time passwordless invitees create their initial password. The server exposes only a boolean for the signed-in partner, never any credential data.

Successful acceptance opens the partner dashboard. The owner must still review and activate a revised partner record. Commission tracking activation remains a separate step. Errors appear beside the acceptance button. Failures release the busy state so the user can try again. No offer was accepted on the partner's behalf.

Validation: production build and TypeScript passed. Database check under authenticated Anjana identity confirms no password setup is required; anonymous callers cannot invoke the setup-status function. After deployment, check amended acceptance and the first-invitation setup flow in the browser.
