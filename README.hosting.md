# RESILIA Netlify deployment

Netlify serves the existing site pages from the generated `dist/` directory. `netlify/functions/appointment.mjs` handles the existing same-origin `POST /api/appointment` route. The Cloudflare Worker files are not used by this Netlify deployment.

## Appointment handling

- The API validates and encrypts the submitted appointment fields in Netlify Blobs.
- Encrypted records are removed by a scheduled function after 30 days.
- Resend sends a notification to `resilia.the.resilience@gmail.com`; the API reports success only after Resend confirms that notification.
- A separate acknowledgment email is attempted for the visitor. The API reports `acknowledgmentSent` only when Resend confirms acceptance.
- API keys and the encryption key belong in Netlify environment variables, never in the repository or browser code.

## Required Netlify environment variables

- `RESEND_API_KEY`: a Resend API key allowed to send email.
- `RESEND_FROM_EMAIL`: a sender address on a domain verified in Resend, for example `Resilia <appointments@example.com>`.
- `APPOINTMENT_ENCRYPTION_KEY`: base64 encoding of a randomly generated 32-byte key for AES-GCM record encryption.

Resend requires a verified sender domain for production sending. The Netlify Function fails closed with JSON if any required variable is missing or email/storage processing fails. Request details are never written to application logs.

## Local checks

Install dependencies with `npm install`, build the public files with `npm run build`, and run API validation checks with `npm run test:api`. The tests do not send email or submit personal information. `server.py` remains local development code.
