        // =====================================================================
        //  Diagnostics log — what worked, what didn't, on which browser.
        //  Sends metadata only (type, size, result, timings, engine trace) — never file contents.
        //  File names are included only in Test mode (?test in the URL).
        // =====================================================================
        const APP_VERSION = '4.1';
        const DIAG_ENDPOINT = 'diag/log.php';
        const TEST_MODE = /[?&]test\b/.test(location.search);
        const SESSION_ID = Math.random().toString(36).slice(2, 10);
        const localLog = [];                 // everything this session, for the in-app viewer / export
        let diagQueue = [], diagTimer = null, envSent = false;

        function browserInfo() {
            const ua = navigator.userAgent;
            const m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
            let name = m ? ({ Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[m[1]] || m[1]) : 'Other';
            const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
                     : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
            return `${name} ${m ? m[2] : ''} / ${os}`.trim();
        }

        async function capabilitySnapshot() {
            const caps = {
                webcodecs: 'VideoEncoder' in window, audioDecoder: 'AudioDecoder' in window,
                compressionStream: 'CompressionStream' in window, wasm: typeof WebAssembly !== 'undefined',
                cores: navigator.hardwareConcurrency || 0, memoryGB: navigator.deviceMemory || 0
            };
            try {
                if (caps.webcodecs) {
                    caps.h264Encode = (await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2e6 })).supported;
                    caps.h264Decode = (await VideoDecoder.isConfigSupported({ codec: 'avc1.42001f' })).supported;
                }
                if ('AudioEncoder' in window) {
                    caps.aacEncode = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported;
                }
            } catch (_) {}
            return caps;
        }

        function diagEnabled() {
            const t = document.getElementById('toggleDiag');
            return location.protocol.startsWith('http') && (TEST_MODE || !t || t.checked);
        }

        async function logEvent(evt) {
            const entry = { t: new Date().toISOString(), v: APP_VERSION, sid: SESSION_ID, test: TEST_MODE, ...evt };
            localLog.push(entry);
            if (localLog.length > 2000) localLog.shift();
            renderDiagLog();
            if (!diagEnabled()) return;
            if (!envSent) {
                envSent = true;
                diagQueue.push({ t: entry.t, v: APP_VERSION, sid: SESSION_ID, test: TEST_MODE, type: 'session',
                                 browser: browserInfo(), ua: navigator.userAgent.slice(0, 200), caps: await capabilitySnapshot() });
            }
            diagQueue.push(entry);
            clearTimeout(diagTimer);
            diagTimer = setTimeout(flushDiag, 1500);
        }

        function flushDiag(useBeacon = false) {
            if (!diagQueue.length) return;
            const body = JSON.stringify(diagQueue.splice(0, 50));
            if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon(DIAG_ENDPOINT, new Blob([body], { type: 'application/json' })); }
            else fetch(DIAG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
            if (diagQueue.length) diagTimer = setTimeout(flushDiag, 300);
        }
        window.addEventListener('pagehide', () => flushDiag(true));

        function logFileResult(item, opts, ms) {
            logEvent({
                type: 'file',
                name: TEST_MODE ? item.name : undefined,
                ext: item.extension, cat: item.typeCategory,
                size: item.size, outSize: item.optimizedSize, outExt: item.status === 'done' ? getExtension(item.outName) : undefined,
                saved: item.optimizedSize ? Math.round((1 - item.optimizedSize / item.size) * 1000) / 10 : 0,
                status: item.status, note: item.note,
                ms: Math.round(ms), preset: opts.preset,
                opts: [opts.stripMeta && 'meta', opts.toWebP && 'webp', opts.downscale && 'down', opts.media && 'media', opts.compressContainers && 'pack'].filter(Boolean).join(','),
                trace: item.trace.slice(0, 20),
                browser: browserInfo()
            });
        }

        // Uncaught errors are logged too
        window.addEventListener('error', e => logEvent({ type: 'jserror', note: String(e.message).slice(0, 300), where: `${(e.filename || '').split('/').pop()}:${e.lineno}` }));
        window.addEventListener('unhandledrejection', e => logEvent({ type: 'jserror', note: String(e.reason && e.reason.message || e.reason).slice(0, 300), where: 'promise' }));

        // ---------- In-app viewer (Account sheet) ----------
        function renderDiagLog() {
            const el = document.getElementById('diagList');
            if (!el) return;
            const rows = localLog.filter(e => e.type === 'file' || e.type === 'jserror').slice(-60).reverse();
            document.getElementById('diagCount').innerText = localLog.filter(e => e.type === 'file').length;
            el.innerHTML = rows.length ? rows.map(e => {
                const tone = e.status === 'done' ? 'text-emerald-400' : e.status === 'skipped' ? 'text-amber-300' : 'text-rose-400';
                const label = e.type === 'jserror' ? 'JS error' : e.status;
                return `<div class="py-1.5 border-b border-darkborder/60 last:border-0">
                    <div class="flex items-center gap-2 text-[11px]">
                        <span class="font-semibold ${tone} w-14 flex-shrink-0">${escapeHtml(label)}</span>
                        <span class="uppercase font-bold text-slate-300">${escapeHtml(e.ext || '')}</span>
                        <span class="text-slate-500 truncate">${e.size ? formatBytes(e.size) : ''}${e.outSize ? ' → ' + formatBytes(e.outSize) : ''}${e.ms ? ' · ' + (e.ms / 1000).toFixed(1) + 's' : ''}</span>
                    </div>
                    ${e.note ? `<p class="text-[11px] text-slate-500 truncate" title="${escapeHtml(e.note)}">${escapeHtml(e.note)}</p>` : ''}
                    ${e.trace && e.trace.length ? `<p class="text-[10px] text-slate-600 truncate" title="${escapeHtml(e.trace.join(' › '))}">${escapeHtml(e.trace.join(' › '))}</p>` : ''}
                </div>`;
            }).join('') : '<p class="text-[11px] text-slate-500">Nothing yet — optimize some files.</p>';
        }

        function exportDiagLog() {
            const blob = new Blob([localLog.map(e => JSON.stringify(e)).join('\n') + '\n'], { type: 'application/x-ndjson' });
            triggerDownload(blob, `omniopti-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jsonl`);
        }

