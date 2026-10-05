// Runs the built-in self-test (?test&selftest) against a URL in real Google Chrome
// and writes reports/selftest-latest.json + reports/selftest-latest.md
// Usage: node tests/selftest.mjs https://optimize.groundfloorstudio.rs/ [only=pdf,mp4]
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = (process.argv[2] || 'https://optimize.groundfloorstudio.rs/').replace(/\/?$/, '/');
const only = (process.argv.find(a => a.startsWith('only=')) || '').slice(5);
const url = `${base}index.html?test&selftest${only ? '&only=' + only : ''}&v=${Date.now()}`;

const channel = process.env.PW_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel && channel !== 'none' ? { channel } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
if (process.env.OFFLINE_JSZIP) {   // local testing without internet
    await page.route(/jszip\.min\.js|cdn\.tailwindcss|fonts\.googleapis|font-awesome|canvas-confetti/, r =>
        r.request().url().includes('jszip') ? r.fulfill({ body: fs.readFileSync(process.env.OFFLINE_JSZIP), contentType: 'text/javascript' }) : r.fulfill({ status: 404, body: '' }));
}
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.title.startsWith('SELFTEST DONE'), null, { timeout: 25 * 60 * 1000 });
await page.waitForTimeout(3000); // let diagnostics flush

const results = await page.evaluate(() => filesQueue.map(f => ({
    name: f.name, ext: f.extension, status: f.status, size: f.size, outSize: f.optimizedSize,
    outName: f.outName, note: f.note, trace: f.trace
})));
const env = await page.evaluate(async () => ({ version: APP_VERSION, browser: browserInfo(), caps: await capabilitySnapshot() }));
await page.screenshot({ path: 'reports/selftest-latest.png', fullPage: true });
await browser.close();

const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
const report = { url, when: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), env, counts, consoleErrors, results };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/selftest-latest.json', JSON.stringify(report, null, 2));

const kb = b => b == null ? '–' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
const icon = { done: '✅', skipped: '⚪', error: '❌' };
const md = [
    `# Self-test — ${report.when}`, '',
    `**${env.browser}** · app v${env.version} · ${report.seconds}s · ` + Object.entries(counts).map(([k, v]) => `${icon[k] || ''} ${k}: ${v}`).join(' · '), '',
    `Capabilities: \`${JSON.stringify(env.caps)}\``, '',
    '| | File | Before | After | Saved | Note / trace |', '|---|---|---|---|---|---|',
    ...results.map(r => `| ${icon[r.status] || r.status} | ${r.name} | ${kb(r.size)} | ${kb(r.outSize)} | ${r.outSize ? Math.round((1 - r.outSize / r.size) * 100) + '%' : ''} | ${(r.note || '').replace(/\|/g, '/')}${r.trace?.length ? ' <br><sub>' + r.trace.join(' › ').replace(/\|/g, '/') + '</sub>' : ''} |`),
    '', consoleErrors.length ? '## Console errors\n' + consoleErrors.map(e => '- `' + e.replace(/`/g, "'") + '`').join('\n') : ''
].join('\n');
fs.writeFileSync('reports/selftest-latest.md', md);
console.log(md);
if (counts.error) process.exitCode = 1;
