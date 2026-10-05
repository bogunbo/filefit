        // =====================================================================
        //  UI
        // =====================================================================

        function applyPresetUI() {
            document.querySelectorAll('.preset-btn').forEach(btn => {
                const active = btn.id === `preset-${currentPreset}`;
                btn.className = 'preset-btn py-2 text-xs font-medium rounded-lg transition-all ' +
                    (active ? 'text-white bg-brand-600 shadow' : 'text-slate-400 hover:text-white');
            });
            document.getElementById('presetHint').innerText = PRESET_HINTS[currentPreset];
            document.getElementById('presetChip').innerText = currentPreset[0].toUpperCase() + currentPreset.slice(1);
        }

        function setPreset(preset) {
            currentPreset = preset;
            applyPresetUI();
            saveSettings();
        }

        function statusBadge(item) {
            const savedPercent = item.optimizedSize ? Math.round((1 - item.optimizedSize / item.size) * 100) : 0;
            switch (item.status) {
                case 'ready':
                    return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Ready</span>`;
                case 'optimizing':
                    return `<div class="flex items-center gap-2">
                                <div class="w-20 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                    <div id="bar_${item.id}" class="bg-brand-500 h-full transition-all duration-200" style="width:${item.progress}%"></div>
                                </div>
                                <span id="pct_${item.id}" class="text-[11px] font-semibold text-brand-400 w-8 text-right">${item.progress}%</span>
                            </div>`;
                case 'done':
                    return `<span class="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">−${savedPercent}%</span>`;
                case 'skipped':
                    return `<span class="text-[11px] font-semibold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Kept</span>`;
                case 'error':
                    return `<span class="text-[11px] font-semibold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">Failed</span>`;
            }
            return '';
        }

        const iconBtn = (onclick, title, icon, tone) => `
            <button onclick="${onclick}" title="${title}" aria-label="${title}"
                class="w-8 h-8 rounded-lg flex items-center justify-center transition-all ${tone}">
                <i class="fa-solid ${icon} text-xs"></i>
            </button>`;

        function renderQueue() {
            const container = document.getElementById('fileListContainer');
            document.getElementById('queuePanel').classList.toggle('hidden', filesQueue.length === 0);

            container.innerHTML = filesQueue.map(item => {
                const meta = getCategoryIcon(item.typeCategory);
                const name = escapeHtml(item.name);
                const renamed = item.outName && item.outName !== item.name;
                const noteColor = item.status === 'error' ? 'text-rose-400' : item.status === 'skipped' ? 'text-amber-300/80' : 'text-slate-500';

                let actions = '';
                if (item.status === 'error') actions += iconBtn(`optimizeSingleFile('${item.id}')`, 'Retry', 'fa-rotate-right', 'text-brand-400 hover:bg-brand-600 hover:text-white');
                if (item.status === 'done') actions += iconBtn(`downloadSingleFile('${item.id}')`, 'Download', 'fa-download', 'bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600 hover:text-white');
                if (item.status === 'done' || item.status === 'skipped') actions += iconBtn(`resetFile('${item.id}')`, 'Re-optimize with current settings', 'fa-rotate-left', 'hidden sm:flex text-slate-500 hover:text-white hover:bg-white/5');
                if (item.status !== 'optimizing') actions += iconBtn(`removeFile('${item.id}')`, 'Remove', 'fa-xmark', 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10');

                return `
                <div class="flex items-center gap-3 p-2.5 rounded-2xl bg-darkbg/60 border border-darkborder">
                    ${item.thumbnail
                        ? `<img src="${item.thumbnail}" alt="" class="w-10 h-10 rounded-xl object-cover border border-darkborder flex-shrink-0 bg-slate-800" />`
                        : `<div class="w-10 h-10 rounded-xl ${meta.bg} ${meta.color} flex items-center justify-center flex-shrink-0"><i class="fa-solid ${meta.icon}"></i></div>`}
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-medium text-white truncate" title="${name}">${name}</p>
                        <p class="text-[11px] text-slate-500 truncate">
                            ${formatBytes(item.size)}
                            ${item.status === 'done' ? `<span class="text-emerald-400"> → ${formatBytes(item.optimizedSize)}</span>` : ''}
                            ${renamed && item.status === 'done' ? `<span class="text-sky-400"> · .${escapeHtml(getExtension(item.outName))}</span>` : ''}
                            ${item.note ? `<span class="${noteColor}" title="${escapeHtml(item.note)}"> · ${escapeHtml(item.note)}</span>` : ''}
                            ${item.status === 'optimizing' ? `<span id="stage_${item.id}" class="text-brand-400">${item.stage ? ' · ' + escapeHtml(item.stage) : ''}</span>` : ''}
                        </p>
                    </div>
                    <div class="flex-shrink-0">${statusBadge(item)}</div>
                    <div class="flex items-center flex-shrink-0">${actions}</div>
                </div>`;
            }).join('');
        }

        function updateProgressUI(item) {
            const bar = document.getElementById(`bar_${item.id}`);
            const pct = document.getElementById(`pct_${item.id}`);
            if (bar) bar.style.width = item.progress + '%';
            if (pct) pct.innerText = item.progress + '%';
        }

        async function optimizeSingleFile(id, { silent = false } = {}) {
            const item = filesQueue.find(f => f.id === id);
            if (!item || item.status === 'optimizing') return;
            if (silent && item.status !== 'ready' && item.status !== 'error') return;   // already handled (e.g. retried manually)

            item.status = 'optimizing';
            item.progress = 3;
            item.note = '';
            renderQueue();
            updateStats();
            await nextFrame();

            const setProgress = p => { item.progress = Math.max(item.progress, Math.min(99, Math.round(p))); updateProgressUI(item); };
            item.trace = [];
            setProgress.log = msg => { item.trace.push(String(msg).slice(0, 200)); };
            setProgress.stage = text => {
                item.stage = text;
                const el = document.getElementById(`stage_${item.id}`);
                if (el) el.innerText = text ? ' · ' + text : '';
            };

            const opts = getOptions();
            const t0 = performance.now();
            try {
                const result = await runOptimizer(item, opts, setProgress);
                // Same format, same name and under 0.5% smaller isn't worth replacing the original
                if (result.outName === item.name && result.blob.size > item.size * 0.995 && !/Resized/.test(result.note || '')) {
                    throw new SkipError('Already optimized (less than 0.5% smaller) — kept original');
                }
                item.compressedBlob = result.blob;
                item.optimizedSize = result.blob.size;
                item.outName = result.outName || item.name;
                item.note = result.note || '';
                item.status = 'done';
                addLifetime(item.size - item.optimizedSize);
            } catch (err) {
                item.compressedBlob = item.file;
                item.optimizedSize = null;
                item.outName = item.name;
                if (err instanceof SkipError) {
                    item.status = 'skipped';
                    item.note = err.message;
                } else {
                    console.error(err);
                    item.status = 'error';
                    item.note = err.message || 'Unexpected error';
                    if (err.stack) setProgress.log('stack: ' + err.stack.split('\n').slice(0, 3).join(' | '));
                }
            }
            logFileResult(item, opts, performance.now() - t0);
            item.progress = 100;
            item.stage = '';

            if (!filesQueue.includes(item)) return;
            updateStats();
            renderQueue();
            if (!silent && item.status === 'done') showToast(`Saved ${formatBytes(item.size - item.optimizedSize)} on ${item.outName}`);
        }

        async function optimizeAllFiles() {
            if (isBatchRunning) return;
            const readyFiles = filesQueue.filter(f => f.status === 'ready' || f.status === 'error');
            if (readyFiles.length === 0) {
                if (filesQueue.length === 0) fileInput.click();
                return;
            }

            isBatchRunning = true;
            updateStats();

            const CONCURRENCY = Math.min(3, navigator.hardwareConcurrency || 2);
            const queue = readyFiles.map(f => f.id);
            await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
                while (queue.length) await optimizeSingleFile(queue.shift(), { silent: true });
            }));

            isBatchRunning = false;
            updateStats();

            const batch = readyFiles.filter(f => filesQueue.includes(f));
            const done = batch.filter(f => f.status === 'done');
            const saved = done.reduce((a, f) => a + (f.size - f.optimizedSize), 0);
            const failed = batch.filter(f => f.status === 'error').length;

            if (done.length) {
                if (window.confetti) confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 } });
                showToast(`Optimized ${done.length} file${done.length === 1 ? '' : 's'} · saved ${formatBytes(saved)}${failed ? ` · ${failed} failed` : ''}`);
            } else {
                showToast(failed ? `${failed} file(s) failed to optimize` : 'Nothing could be reduced further', 'warning');
            }
        }

        function triggerDownload(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function downloadSingleFile(id) {
            const item = filesQueue.find(f => f.id === id);
            if (!item || !item.compressedBlob) return;
            triggerDownload(item.compressedBlob, item.outName);
        }

        async function downloadAllZip() {
            const completed = filesQueue.filter(f => f.status === 'done' || f.status === 'skipped');
            if (completed.length === 0) return;
            if (completed.length === 1) return triggerDownload(completed[0].compressedBlob, completed[0].outName);

            const total = completed.reduce((a, f) => a + f.compressedBlob.size, 0);
            if (total > 3.8 * 1024 ** 3) { showToast('Over 4 GB — too big for one ZIP, download files individually', 'warning'); return; }
            showToast('Packing ZIP…');
            const zip = new JSZip();
            const used = new Set();
            completed.forEach(item => {
                let name = item.outName, n = 1;
                while (used.has(name.toLowerCase())) {
                    const i = item.outName.lastIndexOf('.');
                    name = i > 0 ? `${item.outName.slice(0, i)} (${n})${item.outName.slice(i)}` : `${item.outName} (${n})`;
                    n++;
                }
                used.add(name.toLowerCase());
                zip.file(name, item.compressedBlob, { compression: 'STORE' });
            });

            const content = await zip.generateAsync({ type: 'blob' });
            triggerDownload(content, `OmniOpti_${new Date().toISOString().slice(0, 10)}.zip`);
        }

        function resetFile(id) {
            const item = filesQueue.find(f => f.id === id);
            if (!item) return;
            Object.assign(item, { status: 'ready', optimizedSize: null, compressedBlob: null, outName: item.name, note: '', progress: 0 });
            updateStats();
            renderQueue();
        }

        function removeFile(id) {
            const item = filesQueue.find(f => f.id === id);
            if (!item || item.status === 'optimizing') return;
            if (item.thumbnail) URL.revokeObjectURL(item.thumbnail);
            filesQueue = filesQueue.filter(f => f.id !== id);
            updateStats();
            renderQueue();
        }

        function clearAllFiles() {
            if (isBatchRunning) { showToast('Wait for the current batch to finish', 'warning'); return; }
            filesQueue.forEach(f => f.thumbnail && URL.revokeObjectURL(f.thumbnail));
            filesQueue = [];
            updateStats();
            renderQueue();
        }

        function updateStats() {
            const totalOrig = filesQueue.reduce((acc, f) => acc + f.size, 0);
            const totalOpt = filesQueue.reduce((acc, f) => acc + (f.optimizedSize || f.size), 0);
            const savedPct = totalOrig > 0 ? Math.round(((totalOrig - totalOpt) / totalOrig) * 100) : 0;
            const ready = filesQueue.filter(f => f.status === 'ready' || f.status === 'error').length;
            const finished = filesQueue.filter(f => f.status === 'done' || f.status === 'skipped').length;
            const hasFiles = filesQueue.length > 0;

            // Account sheet stats
            document.getElementById('statTotalFiles').innerText = filesQueue.length;
            document.getElementById('statOriginalSize').innerText = formatBytes(totalOrig);
            document.getElementById('statOptimizedSize').innerText = formatBytes(totalOpt);
            document.getElementById('statSavedPercent').innerText = `${savedPct}%`;

            // Queue header
            document.getElementById('queueSummary').innerHTML = hasFiles
                ? `${filesQueue.length} file${filesQueue.length === 1 ? '' : 's'} · ${formatBytes(totalOrig)}` +
                  (totalOpt < totalOrig ? ` → <span class="text-emerald-400 font-medium">${formatBytes(totalOpt)} (−${savedPct}%)</span>` : '')
                : '';
            document.getElementById('downloadZipBtn').disabled = finished === 0;

            // Dropzone shrinks to an "add more" bar once there's a queue
            dropzone.classList.toggle('min-h-[340px]', !hasFiles);
            dropzone.classList.toggle('p-10', !hasFiles);
            dropzone.classList.toggle('sm:p-14', !hasFiles);
            dropzone.classList.toggle('p-5', hasFiles);
            document.getElementById('dzIcon').classList.toggle('hidden', hasFiles);
            document.getElementById('dzTitle').innerText = hasFiles ? 'Drop more files' : 'Drop files to optimize';
            document.getElementById('dzTitle').classList.toggle('text-2xl', !hasFiles);
            document.getElementById('dzTitle').classList.toggle('text-base', hasFiles);

            // Main button
            const btn = document.getElementById('optimizeAllBtn');
            const label = document.getElementById('optimizeLabel');
            btn.disabled = isBatchRunning || (hasFiles && ready === 0);
            btn.querySelector('i').className = isBatchRunning ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-bolt';
            if (!hasFiles) { label.innerText = 'Optimize'; btn.disabled = true; }
            else if (isBatchRunning) label.innerText = 'Optimizing…';
            else if (ready) label.innerText = `Optimize ${ready} file${ready === 1 ? '' : 's'}`;
            else label.innerText = 'All done';
        }

        let toastTimer;
        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            document.getElementById('toastMsg').innerText = message;
            document.getElementById('toastIcon').className = type === 'warning'
                ? 'fa-solid fa-triangle-exclamation text-amber-400 text-lg'
                : 'fa-solid fa-circle-check text-emerald-400 text-lg';
            toast.classList.remove('translate-y-6', 'opacity-0');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.add('translate-y-6', 'opacity-0'), 3000);
        }

        window.addEventListener('beforeunload', e => {
            if (filesQueue.some(f => f.status === 'done' || f.status === 'optimizing')) { e.preventDefault(); e.returnValue = ''; }
        });

        // ---------- Init ----------
        if (TEST_MODE) document.getElementById('testBadge').classList.remove('hidden');

        // Self-test: ?test&selftest loads the sample files from diag/samples/ and optimizes them all.
        // Results go to the diagnostics log (diag/log.php) with file names.
        async function runSelfTest() {
            try {
                const manifest = await (await fetch('diag/samples/manifest.json', { cache: 'no-store' })).json();
                const only = (location.search.match(/[?&]only=([^&]+)/) || [])[1];
                const names = only ? manifest.filter(n => decodeURIComponent(only).split(',').some(x => n.endsWith('.' + x) || n === x)) : manifest;
                showToast(`Self-test: loading ${names.length} sample files…`);
                const files = [];
                for (const n of names) {
                    const r = await fetch('diag/samples/' + encodeURIComponent(n), { cache: 'no-store' });
                    if (r.ok) files.push(new File([await r.blob()], n));
                }
                processFiles(files);
                await optimizeAllFiles();
                logEvent({ type: 'selftest', note: `done: ${filesQueue.filter(f => f.status === 'done').length}/${filesQueue.length}` });
                flushDiag();
                document.title = 'SELFTEST DONE · ' + document.title;
            } catch (err) {
                showToast('Self-test failed: ' + err.message, 'warning');
            }
        }
        if (TEST_MODE && /[?&]selftest\b/.test(location.search)) runSelfTest();
        loadSettings();
        updateStats();
    </script>
</body>
</html>
