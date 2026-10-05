# OmniOpti — browser file optimizer

Live: https://optimize.groundfloorstudio.rs/

Everything runs in the visitor's browser — files are never uploaded. 120 file types (images, video, audio, PDF, Office, design-app packages, 3D, fonts, code).

## How this repo works

```
src/            app source (HTML shell + script parts) → assembled by build.sh
public/         what gets uploaded to the website
  index.html    built file (do not edit by hand — edit src/ and run ./build.sh)
  lib/          engines: Ghostscript (PDF), ffmpeg.wasm, Mediabunny, pdf-lib, gltf-transform, woff2, terser…
  diag/log.php  diagnostics endpoint + results page
  diag/samples/ files used by the self-test
tests/selftest.mjs   runs the built-in self-test in real Chrome and writes reports/
reports/        self-test reports (committed automatically)
logs/           diagnostics log pulled from the site daily (committed automatically)
```

### Automations (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| **Deploy to website** | every push to `main` that touches `src/`, `public/`, `build.sh` · or manually | builds, syntax-checks, uploads changed files via FTP, then runs the self-test |
| **Self-test live site** | after each deploy · Mondays · or manually (optionally `only=pdf,mp4`) | opens `?test&selftest` in Google Chrome, saves `reports/selftest-latest.md/json/png` |
| **Collect diagnostics log** | daily · or manually | downloads `diag/log.php` summary + raw log into `logs/` |

### One-time setup (repo → Settings → Secrets and variables → Actions)

Secrets (only you see these):

- `FTP_SERVER` — e.g. `ftp.groundfloorstudio.rs` (cPanel → FTP Accounts → "Configure FTP Client")
- `FTP_USERNAME` — tip: create a dedicated FTP account limited to the subdomain folder
- `FTP_PASSWORD`

Variables:

- `FTP_SERVER_DIR` — folder of the subdomain **relative to the FTP account's home**, ending with `/`
  (e.g. `optimize.groundfloorstudio.rs/`, or `./` if the FTP account is already limited to that folder)
- optional `FTP_PROTOCOL` (`ftps` default, or `ftp`), `FTP_PORT` (21), `SITE_URL`

## Diagnostics

- Visitors (opt-out in Settings) send metadata only: type, size, result, reason, timings, engine trace, browser. Never contents; file names only in Test mode.
- Results page: `/diag/log.php` (filters `?days=7`, `?test=1`, `?ext=pdf`, `?view=json`, `?view=raw`).
- Test your own files: open `/?test` — names are logged, a TEST MODE badge shows.
- Self-test: `/?test&selftest` (or `&only=pdf,mp4`).

## Local development

```bash
./build.sh                       # assemble public/index.html
php -S localhost:8765 -t public  # serve (PHP needed for diag/log.php)
npm i && PW_CHANNEL=chrome node tests/selftest.mjs http://localhost:8765/
```

Licences: Ghostscript WASM is AGPL-3.0, ffmpeg core is GPL — fine for a free public tool.
