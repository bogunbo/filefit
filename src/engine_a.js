        // ---------- Helpers ----------
        function getExtension(filename) {
            const i = filename.lastIndexOf('.');
            return i > 0 ? filename.slice(i + 1).toLowerCase() : '';
        }

        function replaceExtension(filename, newExt) {
            const i = filename.lastIndexOf('.');
            return (i > 0 ? filename.slice(0, i) : filename) + '.' + newExt;
        }

        function getCategory(filename, mimeType) {
            const group = groupForExt(getExtension(filename));
            if (group) return group.cat;
            if (KEPT_AS_IS[getExtension(filename)]) return KEPT_AS_IS[getExtension(filename)].cat;
            if (mimeType.startsWith('image/')) return 'image';
            if (mimeType.startsWith('video/')) return 'video';
            if (mimeType.startsWith('audio/')) return 'audio';
            return 'general';
        }

        function getCategoryIcon(category) {
            switch (category) {
                case 'image': return { icon: 'fa-image', color: 'text-sky-400', bg: 'bg-sky-500/10' };
                case '3d': return { icon: 'fa-cube', color: 'text-orange-400', bg: 'bg-orange-500/10' };
                case 'document': return { icon: 'fa-file-lines', color: 'text-rose-400', bg: 'bg-rose-500/10' };
                case 'design': return { icon: 'fa-pen-nib', color: 'text-pink-400', bg: 'bg-pink-500/10' };
                case 'video': return { icon: 'fa-file-video', color: 'text-purple-400', bg: 'bg-purple-500/10' };
                case 'audio': return { icon: 'fa-file-audio', color: 'text-emerald-400', bg: 'bg-emerald-500/10' };
                case 'font': return { icon: 'fa-font', color: 'text-teal-300', bg: 'bg-teal-500/10' };
                case 'code': return { icon: 'fa-file-code', color: 'text-amber-400', bg: 'bg-amber-500/10' };
                case 'archive': return { icon: 'fa-file-zipper', color: 'text-indigo-400', bg: 'bg-indigo-500/10' };
                default: return { icon: 'fa-file', color: 'text-slate-400', bg: 'bg-slate-500/10' };
            }
        }

        function formatBytes(bytes, decimals = 2) {
            if (!bytes) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
            return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
        }

        function escapeHtml(str) {
            return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        function getOptions() {
            return {
                ...PRESETS[currentPreset],
                preset: currentPreset,
                stripMeta: document.getElementById('toggleMetadata').checked,
                compressContainers: document.getElementById('toggleTextures').checked,
                downscale: document.getElementById('toggleDownscale').checked,
                toWebP: document.getElementById('toggleWebP').checked,
                media: document.getElementById('toggleMedia').checked
            };
        }

        const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
        const libBase = () => new URL('lib/', location.href).href;
        const isAppleWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
        // Largest canvas every browser accepts (iOS/Safari caps at ~16.7 MP)
        const MAX_CANVAS_AREA = isAppleWebKit ? 16777216 : 100000000;

        // Signals that a file was intentionally left untouched (not an error)
        class SkipError extends Error {}
        const skip = msg => { throw new SkipError(msg); };

        async function readHead(file, n) {
            return new Uint8Array(await file.slice(0, n).arrayBuffer());
        }
        const bytesToLatin1 = b => new TextDecoder('latin1').decode(b);
        function looksBinary(bytes) {
            const n = Math.min(bytes.length, 8192);
            for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
            return false;
        }

        // Strict UTF-8 text read: never silently turn other encodings into "�"
        async function readUtf8(file) {
            const buf = new Uint8Array(await file.arrayBuffer());
            const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
            try {
                return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), bom };
            } catch (_) {
                skip('Text isn’t UTF-8 encoded — kept original');
            }
        }
        const withBom = (text, bom) => bom ? '\uFEFF' + text : text;

        // JPEG helpers: frame size (SOF) and EXIF orientation
        function jpegInfo(bytes) {
            const info = { width: 0, height: 0, orientation: 1, orientationAt: -1, littleEndian: false };
            if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return info;
            let i = 2;
            while (i + 9 < bytes.length) {
                if (bytes[i] !== 0xFF) { i++; continue; }
                const m = bytes[i + 1];
                if (m === 0xFF) { i++; continue; }
                if (m === 0xD9 || m === 0xDA) break;
                const len = (bytes[i + 2] << 8) | bytes[i + 3];
                if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                    info.height = (bytes[i + 5] << 8) | bytes[i + 6];
                    info.width = (bytes[i + 7] << 8) | bytes[i + 8];
                } else if (m === 0xE1 && String.fromCharCode(...bytes.subarray(i + 4, i + 8)) === 'Exif') {
                    const t = i + 10, le = bytes[t] === 0x49;
                    const r16 = o => le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1];
                    const r32 = o => le ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
                                        : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
                    try {
                        const ifd = t + r32(t + 4), n = r16(ifd);
                        for (let k = 0; k < n; k++) if (r16(ifd + 2 + k * 12) === 0x0112) {
                            info.orientation = r16(ifd + 2 + k * 12 + 8);
                            info.orientationAt = ifd + 2 + k * 12 + 8;
                            info.littleEndian = le;
                        }
                    } catch (_) {}
                }
                i += 2 + len;
            }
            return info;
        }

        // Animated WebP (VP8X animation flag / ANIM chunk) or APNG (acTL before IDAT)
        async function isAnimatedImage(file, ext) {
            const head = await readHead(file, 1 << 16);
            const str = bytesToLatin1(head);
            if (ext === 'webp') return str.slice(12, 16) === 'VP8X' && (head[20] & 0x02) !== 0 || str.includes('ANIM');
            if (ext === 'png') { const a = str.indexOf('acTL'), d = str.indexOf('IDAT'); return a !== -1 && (d === -1 || a < d); }
            return false;
        }

        // Fetch a (possibly gzipped) binary from lib/. Works whether or not the server auto-decompresses .gz.
        async function fetchMaybeGzip(url) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            let bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
                const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
                bytes = new Uint8Array(await new Response(stream).arrayBuffer());
            }
            return bytes;
        }

        function canvasToBlob(canvas, type, quality) {
            return new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image encoder failed (image too large for this browser?)')), type, quality);
            });
        }

        async function decodeImage(blob, bitmapOptions) {
            if ('createImageBitmap' in window) {
                try { return await createImageBitmap(blob, bitmapOptions); } catch (_) { /* fall through */ }
                if (bitmapOptions) { try { return await createImageBitmap(blob); } catch (_) {} }
            }
            const url = URL.createObjectURL(blob);
            try {
                const img = new Image();
                img.decoding = 'async';
                img.src = url;
                await img.decode();
                return img;
            } catch (_) {
                return null;
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        // Draw an image into a canvas, optionally capping the longest side (stepped downscale for quality).
        // Also keeps within the browser's maximum canvas area.
        function drawToCanvas(source, maxDim) {
            const w = source.width, h = source.height;
            let s = 1;
            if (maxDim && Math.max(w, h) > maxDim) s = maxDim / Math.max(w, h);
            if (w * h * s * s > MAX_CANVAS_AREA) s = Math.sqrt(MAX_CANVAS_AREA / (w * h));
            const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));

            let current = source, cw = w, ch = h;
            while (cw / 2 > tw && ch / 2 > th) {
                cw = Math.round(cw / 2); ch = Math.round(ch / 2);
                const step = document.createElement('canvas');
                step.width = cw; step.height = ch;
                const sctx = step.getContext('2d');
                sctx.imageSmoothingQuality = 'high';
                sctx.drawImage(current, 0, 0, cw, ch);
                current = step;
            }
            const canvas = document.createElement('canvas');
            canvas.width = tw; canvas.height = th;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(current, 0, 0, tw, th);
            return { canvas, resized: tw !== w || th !== h, width: tw, height: th };
        }

        function canvasHasAlpha(canvas) {
            const { width, height } = canvas;
            const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
            const step = data.length > 16e6 ? 16 : 4; // sample big images
            for (let i = 3; i < data.length; i += step) if (data[i] < 255) return true;
            return false;
        }

        async function encodePng(canvas, colors) {
            try {
                const UPNG = await loadLib('upng');
                const { width, height } = canvas;
                const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
                await nextFrame();
                return new Blob([UPNG.encode([data.buffer], width, height, colors)], { type: 'image/png' });
            } catch (err) {
                console.warn('UPNG unavailable, using canvas PNG', err);
                return canvasToBlob(canvas, 'image/png');
            }
        }

        // ---------- JPEG metadata (keep EXIF/ICC when "Strip metadata" is off) ----------
        function extractJpegMetaSegments(bytes) {
            const segs = [];
            if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return segs;
            let i = 2;
            while (i + 4 < bytes.length && bytes[i] === 0xFF) {
                const marker = bytes[i + 1];
                if (marker === 0xFF) { i++; continue; }          // fill byte
                if (marker === 0xDA || marker === 0xD9) break;    // start of scan
                const len = (bytes[i + 2] << 8) | bytes[i + 3];
                // APP1 = EXIF/XMP. ICC (APP2) is dropped: the canvas already converted pixels to sRGB.
                if (marker === 0xE1) segs.push(bytes.slice(i, i + 2 + len));
                i += 2 + len;
            }
            return segs;
        }

        // Pixels are already rotated by the browser, so reset the EXIF Orientation tag to 1
        function resetExifOrientation(seg) {
            try {
                if (String.fromCharCode(...seg.slice(4, 8)) !== 'Exif') return seg;
                const t = 10;
                const le = seg[t] === 0x49;
                const r16 = o => le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1];
                const r32 = o => le ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0
                                    : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0;
                const ifd = t + r32(t + 4);
                const count = r16(ifd);
                for (let n = 0; n < count; n++) {
                    const e = ifd + 2 + n * 12;
                    if (r16(e) === 0x0112) {
                        if (le) { seg[e + 8] = 1; seg[e + 9] = 0; } else { seg[e + 8] = 0; seg[e + 9] = 1; }
                    }
                }
            } catch (_) { /* leave as-is */ }
            return seg;
        }

        async function injectJpegMeta(jpegBlob, segs) {
            if (!segs.length) return jpegBlob;
            const out = new Uint8Array(await jpegBlob.arrayBuffer());
            let rest = out.subarray(2);
            if (rest[0] === 0xFF && rest[1] === 0xE0) {               // drop encoder's JFIF APP0: EXIF must come first
                const len = (rest[2] << 8) | rest[3];
                rest = rest.subarray(2 + len);
            }
            return new Blob([out.subarray(0, 2), ...segs, rest], { type: 'image/jpeg' });
        }

        // =====================================================================
        //  Optimizers — each returns { blob, outName, note? } or throws SkipError
        // =====================================================================

        // ---------- Raster images ----------
        async function optimizeRasterImage(item, opts, setProgress) {
            const ext = item.extension;
            if (await isAnimatedImage(item.file, ext)) skip('Animated image — kept original so the animation survives');
            const bitmap = await decodeImage(item.file);
            if (!bitmap) skip(`This browser can't decode .${ext} images — kept original`);
            setProgress(25);

            const { canvas, resized, width, height } = drawToCanvas(bitmap, opts.downscale ? opts.maxDim : null);
            if (bitmap.close) bitmap.close();
            setProgress(45);
            await nextFrame();

            let blob = null, outExt, note = '';
            const isJpeg = ['jpg', 'jpeg', 'jfif', 'jpe'].includes(ext);

            if (opts.toWebP && ext !== 'webp') {
                const webp = await canvasToBlob(canvas, 'image/webp', opts.webpQ);
                if (webp.type === 'image/webp') { blob = webp; outExt = 'webp'; }
                else note = 'WebP not supported in this browser — kept format. ';
            }

            if (!blob) {
                if (isJpeg || (['heic', 'heif', 'tif', 'tiff', 'avif'].includes(ext) && !canvasHasAlpha(canvas))) {
                    blob = await canvasToBlob(canvas, 'image/jpeg', opts.jpegQ);
                    outExt = isJpeg ? ext : 'jpg';
                    if (isJpeg && !opts.stripMeta) {
                        const segs = extractJpegMetaSegments(new Uint8Array(await item.file.arrayBuffer()))
                            .map(s => s[4] === 0x45 ? resetExifOrientation(s) : s);
                        blob = await injectJpegMeta(blob, segs);
                    }
                } else if (ext === 'webp') {
                    blob = await canvasToBlob(canvas, 'image/webp', opts.webpQ);
                    outExt = 'webp';
                } else {
                    setProgress(55);
                    blob = await encodePng(canvas, opts.pngColors);   // PNG / BMP → quantized PNG
                    outExt = 'png';
                }
            }
            setProgress(90);

            const sameFormat = outExt === ext;
            if (blob.size >= item.size && !resized) {
                skip(note + (sameFormat ? 'Already well optimized — kept original' : 'Converted file would be larger — kept original'));
            }
            if (resized) note += `Resized to ${width}×${height}. `;
            return { blob, outName: sameFormat ? item.name : replaceExtension(item.name, outExt), note: note.trim() };
        }

        // ---------- Text-safety helpers ----------
        // Replace protected regions with placeholders, transform the rest, then restore.
        function withStash(text, patterns, transform) {
            const keep = [];
            let s = text;
            for (const re of patterns) s = s.replace(re, m => `\u0001${keep.push(m) - 1}\u0001`);
            s = transform(s);
            // restore (placeholders can be nested, e.g. a string inside url())
            for (let guard = 0; guard < 5 && /\u0001\d+\u0001/.test(s); guard++) {
                s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
            }
            return s;
        }

        // ---------- SVG ----------
        function minifySvg(text, precision) {
            return withStash(text, [/<(text|textPath|tspan|style|script|pre)\b[\s\S]*?<\/\1>/gi, /<!\[CDATA\[[\s\S]*?\]\]>/g], s => {
                s = s
                    .replace(/<\?xml[\s\S]*?\?>/g, '')
                    .replace(/<!DOCTYPE[^>[]*>/gi, '')                    // DOCTYPEs with entity definitions are kept
                    .replace(/<!--[\s\S]*?-->/g, '')
                    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
                    .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/gi, '')
                    .replace(/\s+(inkscape|sodipodi|sketch|serif):[\w-]+="[^"]*"/gi, '')
                    .replace(/\s+xmlns:(inkscape|sodipodi|sketch|serif)="[^"]*"/gi, '')
                    .replace(/\s+data-name="[^"]*"/gi, '')
                    .replace(/>\s+(?=[<\u0001])/g, '>')
                    .replace(/\u0001\s+</g, '\u0001<')
                    .replace(/[ \t\r\n]{2,}/g, ' ')
                    .replace(/\s+\/>/g, '/>')
                    .trim();
                if (precision != null && !/objectBoundingBox/.test(s)) {
                    // More decimals for small coordinate systems (icons on a 1×1 or 24×24 grid)
                    const vb = (s.match(/viewBox="([^"]+)"/) || [])[1];
                    const size = vb ? Math.max(...vb.trim().split(/[\s,]+/).map(Number).slice(2).filter(isFinite)) : 1000;
                    const digits = precision + Math.max(0, 2 - Math.floor(Math.log10(size > 0 ? size : 1000)));
                    const round = str => str.replace(/-?\d*\.\d+(?:e-?\d+)?/gi, (n, off, whole) => {
                        let r = String(parseFloat(parseFloat(n).toFixed(digits)));
                        if (r === '-0') r = '0';
                        if (/^-?\./.test(n)) r = r.replace(/^(-?)0\./, '$1.');      // keep compact ".5" form
                        // "10.004.5" must not become "100.5"
                        if (!/[.e]/i.test(r) && whole[off + n.length] === '.') r += ' ';
                        return r;
                    });
                    s = s.replace(/\s(d|points|viewBox|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|stroke-width)="([^"]*)"/g,
                        (m, attr, val) => ` ${attr}="${round(val)}"`);
                }
                return s;
            });
        }

        async function optimizeSvg(item, opts) {
            const head = await readHead(item.file, 4);
            if (head[0] === 0x1F && head[1] === 0x8B) skip('SVGZ is already compressed');
            const { text, bom } = await readUtf8(item.file);
            const out = withBom(minifySvg(text.replace(/^\uFEFF/, ''), opts.svgPrecision), bom);
            const blob = new Blob([out], { type: 'image/svg+xml' });
            if (blob.size >= item.size) skip('Already minified — kept original');
            return { blob, outName: item.name };
        }

        // ---------- Code / data ----------
        const STRING_RE = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g;

        function minifyCss(css) {
            const keep = [];
            const stash = m => `\u0001${keep.push(m) - 1}\u0001`;
            // One pass so quotes inside comments (e.g. /* don't */) can't swallow real rules
            let s = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, m => m[0] === '/' ? '' : stash(m));
            s = s.replace(/url\(\s*[^)'"\u0001]*\)/gi, stash)
                .replace(/\s+/g, ' ')
                .replace(/\s*([{};,])\s*/g, '$1')
                .replace(/\s*>\s*/g, '>')
                .replace(/\{([^{}]*)\}/g, (m, body) => '{' + body.replace(/\s*:\s*/g, ':') + '}') // only inside declaration blocks
                .replace(/;}/g, '}')
                .trim();
            for (let guard = 0; guard < 5 && /\u0001\d+\u0001/.test(s); guard++) s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
            return s;
        }

        function minifyHtml(html) {
            return withStash(html, [/<(pre|textarea|script|code)\b[\s\S]*?<\/\1>/gi, /<style\b[^>]*>[\s\S]*?<\/style>/gi], s => s
                .replace(/<!--(?!\[if|\s*\[endif)[\s\S]*?-->/g, '')
                .replace(/\s{2,}/g, ' ')            // collapse runs (keeps one space so inline text stays the same)
                .replace(/>\s+</g, '> <')
                .trim()
            ).replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => `<style${attrs}>${minifyCss(css)}</style>`);
        }

        // Whitespace-only JSON minifier: never re-parses numbers, so big IDs and precision are preserved
        function minifyJson(text) {
            let out = '', inStr = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                if (inStr) {
                    out += c;
                    if (c === '\\') { out += text[++i]; continue; }
                    if (c === '"') inStr = false;
                } else if (c === '"') { inStr = true; out += c; }
                else if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') out += c;
            }
            return out;
        }

        function minifyXml(text, ext) {
            // xliff/plist and xml:space="preserve" carry meaningful whitespace between tags
            const sensitive = ['xliff', 'xlf', 'plist'].includes(ext) || /xml:space\s*=\s*["']preserve/.test(text);
            return withStash(text, [/<!\[CDATA\[[\s\S]*?\]\]>/g], s => {
                s = s.replace(/<!--[\s\S]*?-->/g, '');
                if (!sensitive) s = s.replace(/>[ \t]*\r?\n\s*</g, '><');   // only indentation (whitespace containing a newline)
                return s.trim();
            });
        }

        const JSON_EXTS = ['json', 'geojson', 'topojson', 'webmanifest', 'map', 'har', 'gltf', 'babylon'];
        const XML_EXTS = ['xml', 'kml', 'gpx', 'dae', 'xliff', 'xlf', 'rss', 'atom', 'plist', 'xsd'];

        async function optimizeCode(item) {
            const ext = item.extension;
            const head = await readHead(item.file, 8192);
            if (looksBinary(head)) skip('Binary file — kept original');
            let { text, bom } = await readUtf8(item.file);
            text = text.replace(/^\uFEFF/, '');
            let out, type = item.file.type || 'text/plain';

            if (JSON_EXTS.includes(ext)) {
                try { JSON.parse(text); } catch (_) { skip('Invalid JSON — kept original'); }
                out = minifyJson(text);
                type = 'application/json';
            } else if (ext === 'css') {
                out = minifyCss(text); type = 'text/css';
            } else if (ext === 'html' || ext === 'htm') {
                out = minifyHtml(text); type = 'text/html';
            } else if (['js', 'mjs', 'cjs'].includes(ext)) {
                let Terser;
                try { Terser = await loadLib('terser'); } catch (_) { skip('JS minifier could not load — kept original'); }
                try {
                    const res = await Terser.minify(text, { compress: true, mangle: true, module: ext === 'mjs', format: { comments: /^!|@license|@preserve/ } });
                    out = res.code;
                } catch (err) {
                    skip('JavaScript syntax not supported by the minifier — kept original');
                }
                type = 'text/javascript';
            } else if (XML_EXTS.includes(ext)) {
                if (!/^\s*</.test(text)) skip('Not an XML file — kept original');
                out = minifyXml(text, ext); type = 'application/xml';
            } else {
                skip('Kept as-is');
            }

            const blob = new Blob([withBom(out, bom && !JSON_EXTS.includes(ext))], { type });
            if (blob.size >= item.size) skip('Already minified — kept original');
            return { blob, outName: item.name };
        }

