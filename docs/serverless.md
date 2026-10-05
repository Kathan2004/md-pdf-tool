# Serverless deployment (Netlify + alternatives)

This setup gives you a single hosted API for Markdown to PDF so all devices can use it without local installs.

## What is included

- Netlify function endpoint: `/.netlify/functions/md-to-pdf`
- Input: JSON with `markdown`
- Output: PDF bytes

Files added:
- `package.json`
- `netlify.toml`
- `netlify/functions/md-to-pdf.js`

## 1) Deploy on Netlify

### Prerequisites

- Netlify account
- Git repo for this folder
- Node.js 20+

### Deploy steps

```powershell
npm install
npx netlify login
npx netlify init
npx netlify deploy --build
npx netlify deploy --build --prod
```

Netlify will print your production URL, for example:

- `https://your-site.netlify.app/.netlify/functions/md-to-pdf`

## 2) Test the function locally

```powershell
npm run dev
```

On Windows PowerShell where script execution is restricted, use:

```powershell
npx.cmd netlify dev --offline --port 8888 --functions-port 9999 --no-open
```

Then open:

- `http://localhost:8888/index.html`

Use the UI to:

- Paste or upload a `.md` file
- Click **Generate PDF**

The UI auto-calls `/.netlify/functions/md-to-pdf` from the same site.
No manual API endpoint input is required.

If Netlify reports `EADDRINUSE ... :3999`, a stale process is using the internal port.
Find and stop it:

```powershell
netstat -ano | findstr :3999
taskkill /PID <PID_FROM_NETSTAT> /F
```

In another terminal:

```powershell
$md = Get-Content "./vidalhealth.com.md" -Raw
$body = @{ markdown = $md; title = "Vidal Report" } | ConvertTo-Json -Depth 5
Invoke-WebRequest -Uri "http://localhost:8888/.netlify/functions/md-to-pdf" -Method POST -ContentType "application/json" -Body $body -OutFile "./vidalhealth.serverless.pdf"
```

## 3) Call it from any device

Use the same endpoint and send markdown text.

By default, generated PDFs include TOC/Index from headings (`H1`/`H2`).

PowerShell example:

```powershell
$md = Get-Content "./input.md" -Raw
$body = @{ markdown = $md; title = "My Doc" } | ConvertTo-Json
Invoke-WebRequest -Uri "https://your-site.netlify.app/.netlify/functions/md-to-pdf" -Method POST -ContentType "application/json" -Body $body -OutFile "./output.pdf"
```

## 4) Recommended production hardening

- Add an API key check in function headers.
- Restrict CORS origin to your allowed app domain(s).
- Add request size checks to reject very large markdown payloads.

## 5) Important limits and best fit

For very large reports (like huge credential tables), serverless browser rendering may hit function time/memory limits.

If that happens, use one of these:

1. Cloud Run (container) with your existing Pandoc + wkhtmltopdf script.
2. AWS Lambda container image with Pandoc + wkhtmltopdf.
3. Render background worker service.

These container-based options are more reliable for long, heavy PDF jobs.

## 6) Cloud Run fallback (best for heavy reports)

Why: keeps your exact current quality and handles long conversions better than short-lived functions.

High-level steps:

1. Put your converter in a small API container.
2. Install Pandoc and wkhtmltopdf in Docker image.
3. Deploy to Cloud Run.
4. Call one HTTPS endpoint from every device.

If you want, I can scaffold this Cloud Run container next in this same workspace.
