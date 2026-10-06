    <script>
        // =====================================================================
        //  FileFit — real, 100% client-side optimization engine
        // =====================================================================

        // ---------- State ----------
        let filesQueue = [];
        let currentPreset = 'balanced'; // 'low' | 'balanced' | 'aggressive'
        let isBatchRunning = false;

        // Encoder settings per preset
        const PRESETS = {
            low:        { jpegQ: 0.90, webpQ: 0.90, pngColors: 0,   maxDim: 3840, svgPrecision: null, pdfJpegQ: 0.85 },
            balanced:   { jpegQ: 0.78, webpQ: 0.80, pngColors: 256, maxDim: 3840, svgPrecision: 3,    pdfJpegQ: 0.72 },
            aggressive: { jpegQ: 0.62, webpQ: 0.66, pngColors: 128, maxDim: 2560, svgPrecision: 2,    pdfJpegQ: 0.58 }
        };
        const PRESET_HINTS = {
            low: 'Near-lossless. Images ~90% quality, PDF images 300 dpi, audio 192 kbps, high-bitrate video.',
            balanced: 'Recommended. Visually identical for most uses — images ~80%, PDF 150 dpi, audio 128 kbps.',
            aggressive: 'Smallest files. Visible softening possible — images ~65%, PDF 100 dpi, audio 96 kbps, low-bitrate video.'
        };

        // Libraries are lazy-loaded only when a file needs them.
        // Each tries a copy in ./lib/ next to this page first (fast, works offline), then the CDN.
        const LIBS = {
            pdflib:     { srcs: ['lib/pdf-lib.min.js', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'], global: 'PDFLib' },
            pako:       { srcs: ['lib/pako.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js'], global: 'pako' },
            upng:       { srcs: ['lib/UPNG.js', 'https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js'], global: 'UPNG', deps: ['pako'] },
            sourcemap:  { srcs: ['lib/source-map.js', 'https://cdn.jsdelivr.net/npm/source-map@0.7.3/dist/source-map.js'], global: 'sourceMap' },
            terser:     { srcs: ['lib/terser.min.js', 'https://cdn.jsdelivr.net/npm/terser@5.31.0/dist/bundle.min.js'], global: 'Terser', deps: ['sourcemap'] },
            mediabunny: { srcs: ['lib/mediabunny.min.js', 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.1/dist/bundles/mediabunny.min.cjs'], global: 'Mediabunny' },
            gltf:       { srcs: ['lib/gltf-transform.min.js'], global: 'GLTFT' },
            ffmpeg:     { srcs: ['lib/ffmpeg/ffmpeg.js'], global: 'FFmpegWASM' },
            mp3enc:     { srcs: ['lib/mediabunny-mp3-encoder.min.js', 'https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.61.1/dist/bundles/mediabunny-mp3-encoder.min.js'], global: 'MediabunnyMp3Encoder', deps: ['mediabunny'] }
        };
        const libPromises = {};

        function injectScript(src) {
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = () => { s.remove(); reject(new Error('load failed: ' + src)); };
                document.head.appendChild(s);
            });
        }

        function loadLib(key) {
            const lib = LIBS[key];
            if (window[lib.global]) return Promise.resolve(window[lib.global]);
            if (!libPromises[key]) {
                libPromises[key] = (async () => {
                    for (const dep of (lib.deps || [])) await loadLib(dep);
                    for (const src of lib.srcs) {
                        try { await injectScript(src); } catch (_) { continue; }
                        if (window[lib.global]) return window[lib.global];
                    }
                    throw new Error(`Could not load the ${key} engine (offline?)`);
                })().catch(err => { delete libPromises[key]; throw err; });
            }
            return libPromises[key];
        }

        // ---------- File-type registry: single source of truth for routing, icons and the "Supported files" sheet ----------
        const FORMAT_GROUPS = [
            { cat: 'image', title: 'Photos & images', run: optimizeRasterImage,
              exts: ['jpg', 'jpeg', 'jfif', 'jpe', 'png', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'],
              how: 'Re-encoded at preset quality, PNG colour quantization, optional WebP and 4K downscale. HEIC/TIFF need a browser that can open them (Safari).' },
            { cat: 'image', title: 'Vector graphics', run: optimizeSvg, exts: ['svg'],
              how: 'Removes editor junk (Illustrator, Inkscape, Sketch, Figma exports), comments and whitespace; rounds coordinates.' },
            { cat: 'video', title: 'Video', media: true,
              exts: ['mp4', 'm4v', 'mov', 'qt', 'mkv', 'webm', 'ts', 'mts', 'm2ts'],
              how: 'Re-encoded to MP4 (H.264 + AAC) with your device’s hardware encoder. Falls back to the software encoder when needed. Optional 1080p / 720p downscale.' },
            { cat: 'video', title: 'Video — legacy & camera formats', media: true, legacy: true,
              exts: ['avi', 'wmv', 'asf', 'flv', 'f4v', '3gp', '3g2', 'mpg', 'mpeg', 'm2v', 'vob', 'ogv', 'mxf', 'dv', 'divx', 'rm', 'rmvb', 'y4m'],
              how: 'Converted to MP4 (H.264 + AAC) with the built-in software encoder (≈10 MB download the first time; slower than hardware).' },
            { cat: 'audio', title: 'Audio', media: true,
              exts: ['mp3', 'wav', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'weba'],
              how: 'MP3/WAV/FLAC → MP3, M4A/AAC → AAC, OGG/Opus → Opus at 192 / 128 / 96 kbps.' },
            { cat: 'audio', title: 'Audio — legacy formats', media: true, legacy: true,
              exts: ['wma', 'aif', 'aiff', 'aifc', 'amr', 'ac3', 'au', 'caf', 'mka', 'ape', 'wv'],
              how: 'Converted to MP3 with the built-in software encoder.' },
            { cat: 'document', title: 'PDF', run: optimizePdf, exts: ['pdf'],
              how: 'Ghostscript engine (≈11 MB download the first time): downsamples images to 300 / 150 / 100 dpi, subsets fonts, removes duplicates. Signed PDFs are left untouched; PDFs with form fields use a gentler mode that keeps the fields.' },
            { cat: 'document', title: 'Microsoft Office & OpenDocument', run: optimizeZipContainer,
              exts: ['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'xltx', 'pptx', 'pptm', 'potx', 'ppsx', 'vsdx', 'odt', 'ods', 'odp', 'odg'],
              how: 'Recompresses embedded photos and repacks at maximum compression. Word, Excel, PowerPoint, Visio, LibreOffice.' },
            { cat: 'design', title: 'Design & creative apps', run: optimizeZipContainer,
              exts: ['xd', 'idml', 'sketch', 'kra', 'ora', 'xmind', 'lottie'],
              how: 'Adobe XD, InDesign IDML, Sketch, Krita, OpenRaster, XMind, dotLottie — embedded photos recompressed, package repacked.' },
            { cat: 'document', title: 'E-books & comics', run: optimizeZipContainer, exts: ['epub', 'cbz'],
              how: 'Pages/illustrations recompressed, package repacked (EPUB structure kept valid).' },
            { cat: '3d', title: 'Blender', run: optimizeBlend, exts: ['blend'],
              how: 'Gzip-compressed — opens directly in Blender. Already-compressed files are skipped.' },
            { cat: '3d', title: 'FBX', run: optimizeFbx, exts: ['fbx'],
              how: 'Binary FBX: all geometry & animation arrays compressed with the format’s own zlib compression, embedded JPEG textures recompressed — opens in Blender, Maya, 3ds Max, Unity, Unreal, three.js. ASCII FBX: numbers shortened.' },
            { cat: '3d', title: 'glTF / GLB', run: (item, opts, p) => item.extension === 'gltf' ? optimizeGltf(item, opts, p) : optimizeGlb(item, opts, p), exts: ['glb', 'gltf'],
              how: 'Removes duplicate/unused data (named empties, extras and UV sets are kept), resizes & recompresses colour textures; normal/roughness/AO maps stay lossless. Aggressive also quantizes meshes. Self-contained .gltf becomes a .glb.' },
            { cat: '3d', title: 'CAD — STEP', run: optimizeStep, exts: ['step', 'stp'],
              how: 'Lossless: comments and whitespace removed, numbers written in their shortest exact form. Opens in SolidWorks, Fusion, FreeCAD, Rhino…' },
            { cat: '3d', title: '3D meshes', run: (item, opts) => item.extension === 'stl' ? optimizeStl(item) : item.extension === 'ply' ? optimizePly(item) : optimizeObj(item, opts), exts: ['stl', 'obj', 'ply'],
              how: 'ASCII STL / PLY → binary (≈70–80% smaller, lossless). OBJ: comments removed, coordinates rounded to 6 / 5 / 4 decimals.' },
            { cat: '3d', title: '3D scene XML', run: optimizeCode, exts: ['dae', 'x3d'],
              how: 'Collada & X3D: indentation and comments removed.' },
            { cat: '3d', title: 'HDR environment maps', run: optimizeHdr, exts: ['hdr', 'pic'],
              how: 'Radiance HDR: lossless RLE recompression, plus resolution caps with float-accurate filtering — Low: lossless only · Balanced: max 4K · Aggressive: max 2K (one step smaller with “Downscale”).' },
            { cat: '3d', title: '3D printing & maps', run: optimizeZipContainer, exts: ['3mf', 'kmz'],
              how: '3MF (Cura, PrusaSlicer, Bambu Studio) and Google Earth KMZ — repacked at maximum compression.' },
            { cat: 'font', title: 'Fonts', run: optimizeFont, exts: ['ttf', 'otf'],
              how: 'Converted to WOFF2 — the compressed web-font format (typically 50–70% smaller).' },
            { cat: 'code', title: 'Web code', run: optimizeCode, exts: ['js', 'mjs', 'cjs', 'css', 'html', 'htm'],
              how: 'Minified. JavaScript via Terser; licence comments kept.' },
            { cat: 'code', title: 'Data & markup', run: optimizeCode,
              exts: ['json', 'geojson', 'topojson', 'webmanifest', 'map', 'har', 'babylon', 'xml', 'kml', 'gpx', 'xliff', 'xlf', 'rss', 'atom', 'plist', 'xsd'],
              how: 'Whitespace & comments removed. Numbers are never rewritten, so data stays exact.' },
            { cat: 'archive', title: 'Archives', run: (item, opts, p) => item.extension === 'tar' ? optimizeTar(item, opts) : optimizeZipContainer(item, opts, p), exts: ['zip', 'tar'],
              how: 'ZIP: photos inside recompressed, repacked at maximum compression. TAR → TAR.GZ.' }
        ];
        const EXT_INDEX = {};
        FORMAT_GROUPS.forEach(g => g.exts.forEach(e => { EXT_INDEX[e] = g; }));
        const groupForExt = ext => EXT_INDEX[ext] || null;

        const KEPT_AS_IS = {
            gif:  { cat: 'image', why: 'GIF kept as-is (re-encoding would drop animation)' },
            ico:  { cat: 'image', why: 'Icon files are kept as-is' },
            psd:  { cat: 'design', why: 'Photoshop files can’t be rewritten safely in a browser — kept original' },
            ai:   { cat: 'design', why: 'Illustrator files would lose editability — kept original' },
            eps:  { cat: 'design', why: 'EPS kept as-is' },
            indd: { cat: 'design', why: 'InDesign files are proprietary — kept original (use IDML)' },
            fig:  { cat: 'design', why: 'Figma files are proprietary — kept original' },
            afdesign: { cat: 'design', why: 'Affinity files are proprietary — kept original' },
            afphoto: { cat: 'design', why: 'Affinity files are proprietary — kept original' },
            '3ds': { cat: '3d', why: '3DS is a legacy binary format — kept original (export FBX/GLB instead)' },
            max:  { cat: '3d', why: '3ds Max scenes are proprietary — kept original' },
            c4d:  { cat: '3d', why: 'Cinema 4D scenes are proprietary — kept original' },
            ma:   { cat: '3d', why: 'Maya scenes are kept as-is' },
            mb:   { cat: '3d', why: 'Maya binary scenes are proprietary — kept original' },
            '3dm': { cat: '3d', why: 'Rhino files are proprietary — kept original' },
            skp:  { cat: '3d', why: 'SketchUp files are proprietary — kept original' },
            abc:  { cat: '3d', why: 'Alembic caches are kept as-is' },
            usd:  { cat: '3d', why: 'USD is kept as-is' },
            usdc: { cat: '3d', why: 'USD crate files are already compressed' },
            usda: { cat: '3d', why: 'USD ASCII is kept as-is' },
            iges: { cat: '3d', why: 'IGES uses a fixed column layout — kept original' },
            igs:  { cat: '3d', why: 'IGES uses a fixed column layout — kept original' },
            sldprt: { cat: '3d', why: 'SolidWorks files are proprietary — kept original (export STEP)' },
            dwg:  { cat: '3d', why: 'DWG is proprietary — kept original' },
            exr:  { cat: 'image', why: 'OpenEXR is not supported yet — kept original' },
            usdz: { cat: '3d', why: 'USDZ must stay uncompressed for AR Quick Look — kept original' },
            rar:  { cat: 'archive', why: '.rar archives are kept as-is' },
            '7z': { cat: 'archive', why: '.7z archives are kept as-is' },
            gz:   { cat: 'archive', why: 'Already compressed (.gz)' },
            woff: { cat: 'font', why: 'WOFF fonts are already compressed' },
            woff2: { cat: 'font', why: 'Already WOFF2' }
        };
        const KEPT_LIST = Object.keys(KEPT_AS_IS);

        function mediaSupportLabel() {
            const v = 'VideoEncoder' in window, a = 'AudioDecoder' in window;
            if (v && a) return { ok: true, text: 'Hardware-accelerated in this browser' };
            return { ok: false, text: 'Software encoder in this browser (slower)' };
        }

        function renderFormats() {
            const media = mediaSupportLabel();
            const total = FORMAT_GROUPS.reduce((n, g) => n + g.exts.length, 0);
            const chip = e => `<span class="uppercase font-bold text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 border border-slate-700">${e}</span>`;
            document.getElementById('formatsList').innerHTML =
                `<p class="text-xs text-slate-400 -mt-1 mb-1">${total} file types optimized · a result is never larger than the original.</p>` +
                FORMAT_GROUPS.map(f => {
                const meta = getCategoryIcon(f.cat);
                const badge = f.media && !f.legacy
                    ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${media.ok ? 'text-emerald-300 bg-emerald-500/10' : 'text-amber-300 bg-amber-500/10'}">${media.text}</span>` : '';
                return `
                <div class="flex gap-3.5 p-3 rounded-2xl bg-darkbg/60 border border-darkborder">
                    <div class="w-10 h-10 rounded-xl ${meta.bg} ${meta.color} flex items-center justify-center flex-shrink-0"><i class="fa-solid ${meta.icon}"></i></div>
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2 mb-1"><p class="text-sm font-semibold text-white">${f.title}</p>${badge}</div>
                        <div class="flex flex-wrap gap-1 mb-1.5">${f.exts.map(chip).join('')}</div>
                        <p class="text-[11px] text-slate-400 leading-relaxed">${f.how}</p>
                    </div>
                </div>`;
            }).join('') + `
                <div class="pt-2">
                    <p class="text-[11px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Accepted but kept as-is</p>
                    <div class="flex flex-wrap gap-1">${KEPT_LIST.map(chip).join('')}</div>
                    <p class="text-[11px] text-slate-500 mt-2">Any other file can be added too — it’s returned unchanged.</p>
                </div>`;
        }

        // ---------- Settings persistence (per browser) ----------
        const SETTINGS_KEY = 'omniopti.settings.v1';
        const TOGGLES = ['toggleMetadata', 'toggleWebP', 'toggleDownscale', 'toggleMedia', 'toggleTextures', 'toggleDiag'];

        function saveSettings() {
            const data = { preset: currentPreset };
            TOGGLES.forEach(id => data[id] = document.getElementById(id).checked);
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (_) {}
        }
        function loadSettings() {
            let data = null;
            try { data = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (_) {}
            if (data) {
                TOGGLES.forEach(id => { if (typeof data[id] === 'boolean') document.getElementById(id).checked = data[id]; });
                if (PRESETS[data.preset]) currentPreset = data.preset;
            }
            applyPresetUI();
        }
        TOGGLES.forEach(id => document.getElementById(id).addEventListener('change', saveSettings));

        // ---------- Lifetime stats (per browser) ----------
        const LIFE_KEY = 'omniopti.lifetime.v1';
        function getLifetime() {
            try { return JSON.parse(localStorage.getItem(LIFE_KEY)) || { files: 0, saved: 0 }; } catch (_) { return { files: 0, saved: 0 }; }
        }
        function addLifetime(saved) {
            const l = getLifetime(); l.files += 1; l.saved += saved;
            try { localStorage.setItem(LIFE_KEY, JSON.stringify(l)); } catch (_) {}
        }
        function renderLifetime() {
            const l = getLifetime();
            document.getElementById('lifeFiles').innerText = l.files.toLocaleString();
            document.getElementById('lifeSaved').innerText = formatBytes(l.saved);
        }
        function resetLifetime() {
            try { localStorage.removeItem(LIFE_KEY); } catch (_) {}
            renderLifetime();
        }

        // ---------- Sheets (dialogs) ----------
        function openSheet(id) {
            const d = document.getElementById(id);
            if (id === 'formatsDialog') renderFormats();
            if (id === 'accountDialog') { updateStats(); renderLifetime(); renderDiagLog(); }
            if (!d.open) d.showModal();
        }
        function closeSheet(el) { el.closest('dialog').close(); }
        document.querySelectorAll('dialog.sheet').forEach(d => {
            d.addEventListener('click', e => { if (e.target === d) d.close(); }); // click on backdrop
        });

        // ---------- Drag & drop ----------
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false);
        });
        ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, () => dropzone.classList.add('dropzone-active')));
        ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, () => dropzone.classList.remove('dropzone-active')));
        dropzone.addEventListener('drop', e => processFiles(e.dataTransfer.files));
        dropzone.addEventListener('click', e => { if (e.target === fileInput) return; fileInput.click(); });
        // Dropping anywhere on the page also works
        window.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('drop', e => { e.preventDefault(); if (!dropzone.contains(e.target)) processFiles(e.dataTransfer.files); });

        document.addEventListener('paste', e => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length) processFiles(files);
        });

        function handleFileSelect(e) {
            processFiles(e.target.files);
            e.target.value = '';
        }

        function processFiles(files) {
            if (!files || files.length === 0) return;
            const list = Array.from(files);

            list.forEach(file => {
                const ext = getExtension(file.name);
                const fileObj = {
                    id: 'file_' + Math.random().toString(36).slice(2, 11),
                    file,
                    name: file.name,
                    size: file.size,
                    extension: ext,
                    typeCategory: getCategory(file.name, file.type || ''),
                    status: 'ready',       // ready | optimizing | done | skipped | error
                    optimizedSize: null,
                    compressedBlob: null,
                    outName: file.name,
                    note: '',
                    progress: 0,
                    thumbnail: null
                };
                if (['jpg', 'jpeg', 'jfif', 'jpe', 'png', 'webp', 'gif', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) {
                    fileObj.thumbnail = URL.createObjectURL(file);
                }
                filesQueue.push(fileObj);
            });

            updateStats();
            renderQueue();
            showToast(`Added ${list.length} file${list.length === 1 ? '' : 's'}`);
        }

