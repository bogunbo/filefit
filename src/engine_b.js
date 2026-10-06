        // ---------- PDF ----------
        // Primary: Ghostscript (WASM, in a Web Worker) — the same engine desktop PDF compressors use.
        // Fallback: pdf-lib (recompress RGB/gray JPEG images, object streams) when Ghostscript is unavailable
        // or the PDF has fillable form fields (Ghostscript can flatten those).
        const GS_WORKER_SRC = `
            let compiled = null;
            let log = [];
            // This Ghostscript build writes straight to console — capture it
            console.log = console.info = console.warn = console.error = (...a) => { log.push(a.join(' ')); if (log.length > 400) log.shift(); };
            async function fetchMaybeGzip(url) {
                const res = await fetch(url);
                if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
                let b = new Uint8Array(await res.arrayBuffer());
                if (b[0] === 0x1F && b[1] === 0x8B) {
                    b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
                }
                return b;
            }
            function init(base) {
                if (!compiled) {
                    importScripts(base + 'gs/gs.js');
                    compiled = fetchMaybeGzip(base + 'gs/gs.wasm.gz').then(b => WebAssembly.compile(b));
                    compiled.catch(() => { compiled = null; });
                }
                return compiled;
            }
            self.onmessage = async ({ data }) => {
                log = [];
                try {
                    const wasmModule = await init(data.base);
                    const gs = await Module({
                        noInitialRun: true,
                        instantiateWasm: (imports, ok) => {
                            WebAssembly.instantiate(wasmModule, imports).then(inst => ok(inst, wasmModule), err => {
                                self.postMessage({ id: data.id, error: 'Could not start Ghostscript: ' + (err && err.message || err), log });
                            });
                            return {};
                        }
                    });
                    log = [];
                    gs.FS.writeFile('/in.pdf', data.input);
                    let rc;
                    try { rc = gs.callMain(data.args); } catch (e) { rc = (e && e.status) || -1; log.push(String(e && e.message || e)); }
                    let out = null;
                    try { out = gs.FS.readFile('/out.pdf'); } catch (_) {}
                    self.postMessage({ id: data.id, rc, out, log }, out ? [out.buffer] : []);
                } catch (e) {
                    self.postMessage({ id: data.id, error: String(e && e.message || e), log });
                }
            };`;

        let gsWorker = null, gsSeq = 0, gsChain = Promise.resolve();
        const gsPending = new Map();
        function ensureGsWorker() {
            if (!gsWorker) {
                gsWorker = new Worker(URL.createObjectURL(new Blob([GS_WORKER_SRC], { type: 'text/javascript' })));
                gsWorker.onmessage = ({ data }) => { const p = gsPending.get(data.id); if (p) { gsPending.delete(data.id); p(data); } };
                gsWorker.onerror = e => {
                    gsPending.forEach(p => p({ error: e.message || 'Ghostscript worker crashed', log: [] }));
                    gsPending.clear();
                    gsWorker.terminate(); gsWorker = null;
                };
            }
        }
        function runGhostscript(input, args) {
            const id = ++gsSeq;
            const job = () => new Promise(resolve => {
                try { ensureGsWorker(); } catch (e) { return resolve({ error: String(e.message || e), log: [] }); }
                if (!gsWorker) return resolve({ error: 'Ghostscript worker unavailable', log: [] });
                gsPending.set(id, resolve);
                gsWorker.postMessage({ id, base: libBase(), input, args }, [input.buffer]);
            });
            // one PDF at a time: keeps memory in check and logs separate
            const run = gsChain.then(job, job);
            gsChain = run.catch(() => {});
            return run;
        }

        function ghostscriptArgs(preset) {
            const common = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dQUIET',
                '-dAutoRotatePages=/None', '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true',
                '-dPreserveAnnots=true', '-sColorConversionStrategy=LeaveColorUnchanged', '-sOutputFile=/out.pdf'];
            const byPreset = {
                low:        ['-dPDFSETTINGS=/printer'],                                    // 300 dpi images
                balanced:   ['-dPDFSETTINGS=/ebook'],                                      // 150 dpi images
                aggressive: ['-dPDFSETTINGS=/ebook', '-dDownsampleColorImages=true', '-dDownsampleGrayImages=true',
                             '-dColorImageResolution=100', '-dGrayImageResolution=100', '-dMonoImageResolution=300']
            };
            return [...common, ...byPreset[preset], '/in.pdf'];
        }

        // Verify Ghostscript's output and repair what it can lose:
        //  • page count must match the original
        //  • fonts that had a ToUnicode map (needed for copy/paste & search) get it back
        async function verifyAndRepairPdf(originalBytes, rewrittenBytes, opts) {
            const PDFLib = await loadLib('pdflib');
            const { PDFDocument, PDFName, PDFDict } = PDFLib;
            const N = n => PDFName.of(n);
            const orig = await PDFDocument.load(originalBytes, { ignoreEncryption: true, updateMetadata: false });
            const out = await PDFDocument.load(rewrittenBytes, { updateMetadata: false });
            if (orig.getPageCount() !== out.getPageCount() || out.getPageCount() === 0) return { ok: false, why: 'page count changed' };

            const baseName = f => { const b = f.get(N('BaseFont')); return b ? b.toString().replace(/^\//, '').replace(/^[A-Z]{6}\+/, '') : null; };
            const fontsOf = doc => doc.context.enumerateIndirectObjects()
                .map(([, o]) => o)
                .filter(o => o instanceof PDFDict && o.get(N('Type')) === N('Font') && o.get(N('Subtype')) !== N('Type3'));
            const keyOf = f => baseName(f) + '|' + String(f.get(N('Subtype')));
            const src = new Map();
            for (const f of fontsOf(orig)) {
                const tu = f.get(N('ToUnicode'));
                if (!tu || !baseName(f)) continue;
                const k = keyOf(f);
                src.set(k, src.has(k) ? null : orig.context.lookup(tu));   // null = ambiguous (several subsets)
            }
            let repaired = 0;
            for (const f of fontsOf(out)) {
                if (f.get(N('ToUnicode')) || !baseName(f)) continue;
                const k = keyOf(f);
                if (!src.has(k)) continue;                     // original had no text map either
                const tu = src.get(k);
                if (!tu || !tu.contents) return { ok: false, why: 'text layer could not be preserved' };
                const stream = PDFLib.PDFRawStream.of(tu.dict.clone(out.context), tu.contents);
                f.set(N('ToUnicode'), out.context.register(stream));
                repaired++;
            }
            if (opts.stripMeta) stripPdfMetadata(out, PDFLib);
            const packed = await out.save({ useObjectStreams: true });
            return { ok: true, bytes: (repaired || opts.stripMeta || packed.length < rewrittenBytes.length) ? packed : rewrittenBytes, repaired };
        }

        // Re-encode a JPEG keeping its exact pixel grid. Returns null when that can't be guaranteed
        // (rotated via EXIF, CMYK/unsupported, or too large for this browser's canvas).
        // inPdf: PDF viewers ignore EXIF orientation, so we re-encode the raw (unrotated) pixel grid.
        async function reencodeJpegBytes(bytes, quality, inPdf = false) {
            const info = jpegInfo(bytes);
            if (!info.width) return null;
            if (info.orientation !== 1 && !inPdf) return null;
            let src = bytes;
            if (info.orientation !== 1) {               // neutralise the EXIF tag so the browser decodes the raw pixel grid
                src = bytes.slice();
                const o = info.orientationAt;
                if (info.littleEndian) { src[o] = 1; src[o + 1] = 0; } else { src[o] = 0; src[o + 1] = 1; }
            }
            const bmp = await decodeImage(new Blob([src], { type: 'image/jpeg' }));
            if (!bmp) return null;
            if (bmp.width !== info.width || bmp.height !== info.height) { if (bmp.close) bmp.close(); return null; }
            const { canvas, resized } = drawToCanvas(bmp, null);
            if (bmp.close) bmp.close();
            if (resized) return null;
            const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
            return new Uint8Array(await blob.arrayBuffer());
        }

        function decodeAscii85(bytes) {
            const out = [];
            let tuple = 0, count = 0;
            for (let i = 0; i < bytes.length; i++) {
                const c = bytes[i];
                if (c === 0x7E) break;                             // '~>' end
                if (c <= 0x20) continue;                           // whitespace
                if (c === 0x7A && count === 0) { out.push(0, 0, 0, 0); continue; } // 'z'
                tuple = tuple * 85 + (c - 33);
                if (++count === 5) {
                    out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255);
                    tuple = 0; count = 0;
                }
            }
            if (count > 1) {
                for (let k = count; k < 5; k++) tuple = tuple * 85 + 84;
                const b = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255];
                out.push(...b.slice(0, count - 1));
            }
            return new Uint8Array(out);
        }

        function stripPdfMetadata(pdf, PDFLib) {
            const N = PDFLib.PDFName.of;
            pdf.catalog.delete(N('Metadata'));
            ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'].forEach(k => {
                try { pdf.getInfoDict().delete(N(k)); } catch (_) {}
            });
        }

        // Lossless-structure path: recompress embedded JPEGs and pack objects
        async function optimizePdfWithPdfLib(bytes, opts, setProgress) {
            const PDFLib = await loadLib('pdflib');
            const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray } = PDFLib;
            const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
            const N = n => PDFName.of(n);
            // Accept DCTDecode alone, or preceded by ASCII85/Flate wrappers (e.g. ReportLab output)
            const filterList = f => f instanceof PDFArray ? f.asArray().map(String) : f ? [String(f)] : [];
            const isDct = f => {
                const l = filterList(f);
                return l.length > 0 && l[l.length - 1] === '/DCTDecode' && l.slice(0, -1).every(x => x === '/ASCII85Decode' || x === '/FlateDecode');
            };
            const unwrap = async (obj) => {
                let data = obj.contents;
                for (const f of filterList(obj.dict.get(N('Filter'))).slice(0, -1)) {
                    if (f === '/ASCII85Decode') data = decodeAscii85(data);
                    else if (f === '/FlateDecode') data = (await loadLib('pako')).inflate(data);
                }
                return data;
            };
            const okSpace = cs => cs === N('DeviceRGB') || cs === N('DeviceGray');

            const candidates = pdf.context.enumerateIndirectObjects().filter(([, obj]) =>
                obj instanceof PDFRawStream &&
                obj.dict.get(N('Subtype')) === N('Image') &&
                isDct(obj.dict.get(N('Filter'))) &&
                okSpace(obj.dict.get(N('ColorSpace'))) &&
                !obj.dict.get(N('Decode')) && !obj.dict.get(N('SMaskInData')) &&
                obj.contents.length > 20 * 1024);

            let recompressed = 0;
            for (let i = 0; i < candidates.length; i++) {
                const [ref, obj] = candidates[i];
                try {
                    const jpeg = await unwrap(obj);
                    const newBytes = await reencodeJpegBytes(jpeg, opts.pdfJpegQ, true);
                    if (newBytes && newBytes.length < obj.contents.length * 0.9) {
                        const dict = obj.dict.clone(pdf.context);
                        dict.set(N('Length'), PDFNumber.of(newBytes.length));
                        dict.set(N('Filter'), N('DCTDecode'));
                        dict.set(N('ColorSpace'), N('DeviceRGB')); // canvas always writes 3-channel JPEG
                        dict.delete(N('DecodeParms'));
                        pdf.context.assign(ref, PDFRawStream.of(dict, newBytes));
                        recompressed++;
                    }
                } catch (err) { console.warn('PDF image skipped', err); }
                setProgress(30 + Math.round((i + 1) / candidates.length * 50));
            }
            if (opts.stripMeta) stripPdfMetadata(pdf, PDFLib);
            const out = await pdf.save({ useObjectStreams: true });
            return { bytes: out, note: recompressed ? `${recompressed} image(s) recompressed` : '' };
        }

        async function optimizePdf(item, opts, setProgress) {
            const bytes = new Uint8Array(await item.file.arrayBuffer());
            const text = bytesToLatin1(bytes);
            if (!text.slice(0, 1024).includes('%PDF')) skip('Not a valid PDF — kept original');
            if (/\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b|\/FT\s*\/Sig\b/.test(text)) {
                skip('Digitally signed PDF — kept original so the signature stays valid');
            }
            const hasForm = /\/AcroForm\b/.test(text) && /\/FT\s*\/(Tx|Btn|Ch)\b/.test(text);
            const encrypted = /\/Encrypt\b/.test(text);

            let best = null, note = '', gsProblem = '';

            if (!hasForm) {
                setProgress.stage('Loading PDF engine…');
                setProgress(10);
                const res = await runGhostscript(bytes.slice(), ghostscriptArgs(opts.preset));
                setProgress.stage('');
                const log = (res.log || []).join('\n');
                setProgress.log(res.error ? 'ghostscript error: ' + res.error : `ghostscript rc=${res.rc} out=${res.out ? res.out.length : 0}`);
                if (/requires a password/i.test(log)) skip('Password-protected PDF — kept original');
                if (res.error) gsProblem = res.error;
                else if (res.rc !== 0 || !res.out || res.out.length < 200 || /No pages will be processed/.test(log)) gsProblem = 'Ghostscript could not rewrite this PDF';
                else {
                    setProgress(75);
                    let v;
                    try { v = await verifyAndRepairPdf(bytes, res.out, opts); }
                    catch (err) { console.warn('PDF verification failed', err); v = { ok: false, why: 'verification failed' }; }
                    if (!v.ok) gsProblem = v.why;
                    else if (v.repaired) setProgress.log(`text layer repaired on ${v.repaired} font(s)`);
                    else {
                        best = v.bytes;
                        note = encrypted ? 'Optimized (copy restrictions removed)' : '';
                    }
                }
                if (gsProblem) { console.warn('Ghostscript:', gsProblem, log); setProgress.log('ghostscript rejected: ' + gsProblem); }
            }

            if (hasForm) setProgress.log('form fields detected → pdf-lib only');
            if (!best || best.length >= item.size) {
                setProgress.log('pdf-lib pass');
                setProgress(20);
                try {
                    const r = await optimizePdfWithPdfLib(bytes, opts, setProgress);
                    if (!best || r.bytes.length < best.length) { best = r.bytes; note = r.note; }
                } catch (err) {
                    if (!best) {
                        if (/encrypt/i.test(err.message)) skip('Encrypted PDF — kept original');
                        skip(gsProblem ? 'This PDF could not be processed — kept original' : 'Could not parse this PDF — kept original');
                    }
                }
                if (hasForm && best) note = (note ? note + ' · ' : '') + 'form fields preserved';
            }

            if (!best || best.length >= item.size) skip('PDF is already well optimized — kept original');
            return { blob: new Blob([best], { type: 'application/pdf' }), outName: item.name, note };
        }

        // ---------- Blender .blend ----------
        async function optimizeBlend(item, opts) {
            if (!opts.compressContainers) skip('Blender compression is turned off in settings');
            const head = await readHead(item.file, 7);
            if (head[0] === 0x1F && head[1] === 0x8B) skip('.blend is already compressed (gzip)');
            if (head[0] === 0x28 && head[1] === 0xB5 && head[2] === 0x2F && head[3] === 0xFD) skip('.blend is already compressed (Zstd)');
            if (String.fromCharCode(...head) !== 'BLENDER') skip('Not a valid .blend file');
            if (!('CompressionStream' in window)) skip('This browser lacks CompressionStream — try Chrome/Edge/Firefox');

            const blob = await new Response(item.file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
            if (blob.size >= item.size) skip('Compression gave no gain — kept original');
            return { blob: new Blob([blob], { type: 'application/octet-stream' }), outName: item.name, note: 'Gzip-compressed — opens directly in Blender' };
        }

        // ---------- ZIP-based containers (Office, design apps, e-books, 3MF, KMZ, ZIP…) ----------
        async function optimizeZipContainer(item, opts, setProgress) {
            if (!opts.compressContainers) skip('Document & archive compression is turned off in settings');
            const head = await readHead(item.file, 4);
            if (!(head[0] === 0x50 && head[1] === 0x4B)) skip(`This .${item.extension} isn't ZIP-based — kept original`);
            let zip;
            try { zip = await JSZip.loadAsync(item.file, { createFolders: false }); }
            catch (_) { skip('Could not read archive (encrypted or damaged) — kept original'); }
            setProgress(20);

            const entries = Object.values(zip.files).filter(f => !f.dir);
            if (Object.keys(zip.files).some(n => n.includes('\uFFFD'))) skip('Archive uses non-Unicode file names — kept original');
            let imgs = 0;
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (/\.(jpe?g)$/i.test(entry.name)) {
                    try {
                        const data = await entry.async('uint8array');
                        if (data.length > 20 * 1024) {
                            const re = await reencodeJpegBytes(data, opts.jpegQ);
                            if (re && re.length < data.length * 0.9) {
                                zip.file(entry.name, re, { date: entry.date, createFolders: false });
                                imgs++;
                            }
                        }
                    } catch (_) {}
                }
                setProgress(20 + Math.round((i + 1) / entries.length * 50));
            }

            // EPUB / ODF / Krita / OpenRaster / XD / IDML need their "mimetype" entry first and uncompressed
            if (zip.files['mimetype']) {
                const mt = await zip.file('mimetype').async('uint8array');
                zip.file('mimetype', mt, { compression: 'STORE', createFolders: false });
            }

            const blob = await zip.generateAsync(
                { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 }, mimeType: item.file.type || 'application/zip' },
                meta => setProgress(70 + Math.round(meta.percent * 0.25))
            );
            if (blob.size >= item.size) skip('Already tightly compressed — kept original');
            return { blob, outName: item.name, note: imgs ? `${imgs} embedded image(s) recompressed` : '' };
        }

        // ---------- TAR → TAR.GZ ----------
        async function optimizeTar(item, opts) {
            if (!opts.compressContainers) skip('Archive compression is turned off in settings');
            if (!('CompressionStream' in window)) skip('This browser lacks CompressionStream — try Chrome/Edge/Firefox');
            const head = await readHead(item.file, 265);
            if (bytesToLatin1(head.slice(257, 262)) !== 'ustar') skip('Not a TAR archive — kept original');
            const blob = await new Response(item.file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
            if (blob.size >= item.size) skip('Contents are already compressed — kept original');
            return { blob: new Blob([blob], { type: 'application/gzip' }), outName: item.name + '.gz', note: 'Packed as .tar.gz' };
        }

        // ---------- Fonts: TTF/OTF → WOFF2 ----------
        let woff2Promise = null;
        function loadWoff2() {
            if (!woff2Promise) {
                woff2Promise = (async () => {
                    let src = null;
                    for (const url of [libBase() + 'woff2/compress_binding.js', 'https://cdn.jsdelivr.net/npm/wawoff2@2.0.1/build/compress_binding.js']) {
                        try { const r = await fetch(url); if (r.ok) { src = await r.text(); break; } } catch (_) {}
                    }
                    if (!src) throw new Error('Font engine could not load (offline?)');
                    return await new Promise((resolve, reject) => {
                        const mod = { onRuntimeInitialized: () => resolve(mod), onAbort: reject, print: () => {}, printErr: () => {} };
                        // Run in its own scope so its global "Module" can't clash with other engines
                        new Function('Module', src + '\n;return Module;')(mod);
                    });
                })().catch(err => { woff2Promise = null; throw err; });
            }
            return woff2Promise;
        }

        async function optimizeFont(item) {
            const head = bytesToLatin1(await readHead(item.file, 4));
            if (head === 'wOF2') skip('Already WOFF2');
            if (head === 'wOFF') skip('WOFF fonts are already compressed');
            if (!(head === '\x00\x01\x00\x00' || head === 'OTTO' || head === 'true')) skip('Unrecognized font file — kept original');
            const W = await loadWoff2();
            const out = W.compress(new Uint8Array(await item.file.arrayBuffer()));
            if (!out || !out.length) throw new Error('WOFF2 conversion failed');
            return { blob: new Blob([out], { type: 'font/woff2' }), outName: replaceExtension(item.name, 'woff2'), note: 'Converted to WOFF2 web font' };
        }

        // ---------- 3D: STL (ASCII → binary) ----------
        async function optimizeStl(item) {
            const size = item.size;
            const head = await readHead(item.file, 84);
            const triCount = new DataView(head.buffer).getUint32(80, true);
            if (size === 84 + triCount * 50) skip('Binary STL is already compact');
            const { text } = await readUtf8(item.file);
            if (!/^\s*solid/i.test(text) || !/facet/i.test(text.slice(0, 2000))) skip('Unrecognized STL file — kept original');

            const num = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)';
            const re = new RegExp(`facet\\s+normal\\s+${num}\\s+${num}\\s+${num}\\s+outer\\s+loop\\s+vertex\\s+${num}\\s+${num}\\s+${num}\\s+vertex\\s+${num}\\s+${num}\\s+${num}\\s+vertex\\s+${num}\\s+${num}\\s+${num}\\s+endloop\\s+endfacet`, 'gi');
            const tris = [];
            let m;
            while ((m = re.exec(text))) tris.push(m);
            const declared = (text.match(/endfacet/gi) || []).length;
            if (!tris.length || tris.length !== declared) skip('Could not parse every triangle — kept original');

            const buf = new ArrayBuffer(84 + tris.length * 50);
            const dv = new DataView(buf);
            const header = 'Binary STL converted by FileFit';
            for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
            dv.setUint32(80, tris.length, true);
            tris.forEach((t, i) => {
                const o = 84 + i * 50;
                for (let k = 0; k < 12; k++) dv.setFloat32(o + k * 4, parseFloat(t[k + 1]), true);
                dv.setUint16(o + 48, 0, true);
            });
            return { blob: new Blob([buf], { type: 'model/stl' }), outName: item.name, note: 'ASCII → binary STL' };
        }

        // ---------- 3D: OBJ (comments, whitespace, number precision) ----------
        async function optimizeObj(item, opts) {
            const head = await readHead(item.file, 8192);
            if (looksBinary(head)) skip('Binary file — kept original');
            const decimals = { low: 6, balanced: 5, aggressive: 4 }[opts.preset];
            const round = n => {
                const v = parseFloat(n);
                if (!isFinite(v)) return n;
                let s = v.toFixed(decimals).replace(/\.?0+$/, '');
                if (s === '-0') s = '0';
                return s.length < n.length ? s : n;
            };
            const { text } = await readUtf8(item.file);
            const out = text.split(/\r?\n/).map(line => {
                line = line.trim();
                if (!line || line[0] === '#') return null;
                line = line.replace(/\s+/g, ' ');
                if (/^(v|vn|vt|vp) /.test(line)) {
                    const [cmd, ...nums] = line.split(' ');
                    return cmd + ' ' + nums.map(round).join(' ');
                }
                return line;
            }).filter(l => l !== null).join('\n') + '\n';
            const blob = new Blob([out], { type: 'model/obj' });
            if (blob.size >= item.size) skip('Already compact — kept original');
            return { blob, outName: item.name, note: `Coordinates rounded to ${decimals} decimals` };
        }

        // ---------- 3D: GLB (glTF binary) ----------
        async function gltfIO() {
            const G = await loadLib('gltf');
            await Promise.all([G.MeshoptDecoder.ready, G.MeshoptEncoder.ready]);
            const io = new G.WebIO()
                .registerExtensions(G.ALL_EXTENSIONS)
                .registerDependencies({ 'meshopt.decoder': G.MeshoptDecoder, 'meshopt.encoder': G.MeshoptEncoder });
            return { G, io };
        }

        async function optimizeGlb(item, opts, setProgress) {
            const head = bytesToLatin1(await readHead(item.file, 4));
            if (head !== 'glTF') skip('Not a GLB file — kept original');
            const { G, io } = await gltfIO();
            let doc;
            try { doc = await io.readBinary(new Uint8Array(await item.file.arrayBuffer())); }
            catch (err) {
                if (/draco/i.test(err.message)) skip('Draco-compressed GLB — already optimized');
                skip('Could not read this GLB — kept original');
            }
            const r = await optimizeGltfDocument(doc, G, io, opts, setProgress);
            if (r.out.length >= item.size) skip('GLB is already well optimized — kept original');
            return { blob: new Blob([r.out], { type: 'model/gltf-binary' }), outName: item.name, note: r.notes.join(' · ') };
        }

        // .gltf: self-contained (embedded data: URIs) → optimized GLB. With external .bin/textures → JSON minify only.
        async function optimizeGltf(item, opts, setProgress) {
            const { text } = await readUtf8(item.file);
            let json;
            try { json = JSON.parse(text); } catch (_) { skip('Invalid glTF JSON — kept original'); }
            const uris = [...(json.buffers || []), ...(json.images || [])].map(x => x.uri).filter(Boolean);
            const external = uris.filter(u => !u.startsWith('data:'));
            if (external.length) {
                setProgress.log(`external resources: ${external.slice(0, 3).join(', ')}`);
                const r = await optimizeCode(item);
                r.note = 'JSON minified (textures/.bin are separate files — optimize those too)';
                return r;
            }
            const { G, io } = await gltfIO();
            let doc;
            try { doc = await io.readJSON({ json, resources: {} }); }
            catch (err) {
                if (/draco/i.test(err.message)) skip('Draco-compressed glTF — already optimized');
                skip('Could not read this glTF — kept original');
            }
            const r = await optimizeGltfDocument(doc, G, io, opts, setProgress);
            if (r.out.length >= item.size) skip('glTF is already well optimized — kept original');
            return { blob: new Blob([r.out], { type: 'model/gltf-binary' }), outName: replaceExtension(item.name, 'glb'),
                     note: ['Converted to GLB (single binary file)', ...r.notes].join(' · ') };
        }

        async function optimizeGltfDocument(doc, G, io, opts, setProgress) {
            setProgress(25);

            const PRUNE = { keepLeaves: true, keepAttributes: true, keepExtras: true };   // keep anchors/hotspots & extra UV sets
            const steps = [G.dedup(), G.prune(PRUNE), G.resample()];
            if (opts.preset === 'aggressive') steps.push(G.quantize());
            await doc.transform(...steps);
            setProgress(45);

            // Textures: resize + recompress (stay JPEG/PNG so every viewer can open the file)
            const root = doc.getRoot();
            // Only colour textures may become JPEG; data textures (normal, metal/rough, AO…) stay lossless PNG
            const graph = doc.getGraph();
            const isColorOnly = tex => {
                const uses = graph.listParentEdges(tex).map(e => e.getName()).filter(n => /Texture$/.test(n));
                return uses.length > 0 && uses.every(n => n === 'baseColorTexture' || n === 'emissiveTexture');
            };
            const cap = opts.downscale ? (opts.preset === 'aggressive' ? 1024 : 2048) : 4096;
            const textures = root.listTextures();
            let texDone = 0;
            for (let i = 0; i < textures.length; i++) {
                const tex = textures[i];
                const mime = tex.getMimeType(), img = tex.getImage();
                if (!img || !/image\/(jpeg|png)/.test(mime)) continue;
                try {
                    const bmp = await decodeImage(new Blob([img], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
                    if (!bmp) continue;
                    const { canvas, resized } = drawToCanvas(bmp, cap);
                    if (bmp.close) bmp.close();
                    let blob;
                    const isColor = isColorOnly(tex);
                    if (mime === 'image/png' && (!isColor || canvasHasAlpha(canvas))) {
                        blob = await encodePng(canvas, isColor ? opts.pngColors : 0);
                    } else {
                        blob = await canvasToBlob(canvas, 'image/jpeg', Math.max(opts.jpegQ, 0.8));
                    }
                    if (blob.size < img.length || resized) {
                        tex.setImage(new Uint8Array(await blob.arrayBuffer()));
                        if (blob.type !== mime) {
                            tex.setMimeType(blob.type);
                            if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.png$/i, '.jpg'));
                        }
                        texDone++;
                    }
                } catch (err) { console.warn('Texture skipped', err); }
                setProgress(45 + Math.round((i + 1) / textures.length * 40));
            }

            await doc.transform(G.prune(PRUNE), G.unpartition());
            const out = await io.writeBinary(doc);
            const notes = [];
            if (texDone) notes.push(`${texDone} texture(s) recompressed`);
            if (opts.preset === 'aggressive') notes.push('meshes quantized');
            return { out, notes };
        }

