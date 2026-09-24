# Homeview Property Group – Maintenance Report Portal

Modern, tenant-friendly maintenance report intake portal for **Homeview Property Group**. Tenants can self-triage property issues with interactive step-by-step troubleshooting, attach photos/videos, select appointment availability, and submit requests securely.

## Features

- **Interactive Troubleshooting**: Dynamic diagnosis trees for heating, plumbing, electrical, damp, security, and more.
- **Direct Supabase Integration**: Reliable storage in PostgreSQL (`homereview_submissions`) and persistent file storage (`homereview-files`).
- **Make.com Webhook Delivery**: Dispatches actual binary files and structured JSON over multipart webhook for instant automation (ClickUp, Monday.com, Email, SMS).
- **Dual Relay & Direct Failover**: Seamless same-origin serverless relay via Vercel Edge Functions (`/api/submit-report`) with automatic client-side fallback if hosted on static servers or GitHub Pages.

## Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, ES6 JavaScript
- **Backend / Serverless**: Vercel Edge Function (`api/submit-report.js`)
- **Database & Storage**: Supabase (PostgreSQL & Storage)
- **Workflow Automation**: Make.com Custom Webhook

## Setup & Deployment

1. **Deploy to Vercel or GitHub Pages**:
   - Push to GitHub repository: `https://github.com/Ihtisham-Ali/homeview-maintenance-form`
   - Connect repository to Vercel or host as a static site.
2. **Environment Variables (Optional for Vercel)**:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_KEY`: Your Supabase service role / secret key
   - `SUPABASE_TABLE`: Submissions table (default: `homereview_submissions`)
   - `MAKE_WEBHOOK_URL`: Make.com intake webhook endpoint
