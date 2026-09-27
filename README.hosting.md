# Resilia public hosting setup

This project is prepared for Cloudflare Workers Static Assets. It serves the existing multi-page site and handles `/api/appointment` and `/api/contact` in the same origin. Appointment requests are emailed to Resilia; successful requests also get the branded client acknowledgment.

## What stays private

- Keep `.env`, `logs/`, and `.dev.vars` out of GitHub. `.gitignore` already excludes them.
- Email credentials belong in Cloudflare Worker secrets, never in this repository or browser JavaScript.
- The old local Python server and Cloudflare Tunnel executable are excluded from the public asset upload.
- The Worker does not retain form submissions in a database; the booking and contact details are delivered by email.

## One-time account setup

1. Create or sign in to a GitHub account and create a **private** repository for this site.
2. Create or sign in to a Cloudflare account on the Free plan.
3. Connect the private GitHub repository to Cloudflare Workers Builds and select the `main` production branch.
4. Create/connect the Worker with the exact name `resilia-online`; the name must match `wrangler.jsonc`. Use the repository root as the project directory.
5. Add these Worker secrets in Cloudflare under **Settings → Variables and Secrets**:
   - `SMTP_USER`: the Gmail account used to send Resilia messages
   - `SMTP_PASS`: that account's Gmail App Password
   - `TARGET_EMAIL`: Resilia's appointment inbox
6. Add these non-secret variables if needed:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
7. Enable the `workers.dev` address when Cloudflare offers it. The public URL will look like `https://resilia-online.<your-cloudflare-subdomain>.workers.dev`.
8. Deploy the production branch. Future pushes to `main` deploy automatically.

The Worker sends mail using Gmail SMTP over STARTTLS on port 587. Client-side success distinguishes an accepted receipt from an email-send failure. Provider acceptance means Gmail accepted the message for delivery; it is not proof that the recipient's inbox displayed it.

## Local preparation

Install Node.js, then run `npm install` and `npm run dev`. Wrangler uses the values in a local `.dev.vars` file during development. Do not commit that file.

## Free-plan and uptime expectations

Cloudflare's current Workers Free plan includes 100,000 Worker requests per day; static asset requests do not consume the Worker request quota. The free plan has no fixed 2–3 year service guarantee, and plan limits or policies may change. Keep the GitHub repository as the durable source of truth and export a backup periodically.

GitHub Pages is not selected for this business site: GitHub's terms state Pages is not allowed as free hosting for an online business. Cloudflare serves the site on its own free subdomain, so buying a domain is optional.
