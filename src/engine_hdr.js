        // ---------- HDR (Radiance RGBE .hdr / .pic) ----------
        // Lossless: rewrite every scanline with modern RLE (many tools save flat/uncompressed HDRs).
        // With "Downscale high-res media": shrink environment maps to 4K (2K on Aggressive) with
        // float-accurate box filtering — the usual way to slim HDRIs for web/real-time 3D.
        function hdrDecodeScanline(bytes, pos, width, out) {
            // returns new position; fills out (Uint8Array width*4, RGBE interleaved)
            if (width >= 8 && width < 32768 && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] & 0x80) === 0) {
                const w = (bytes[pos + 2] << 8) | bytes[pos + 3];
                if (w !== width) throw new Error('HDR scanline width mismatch');
                pos += 4;
                for (let c = 0; c < 4; c++) {
                    let x = 0;
                    while (x < width) {
                        let count = bytes[pos++];
                        if (count === undefined) throw new Error('HDR data truncated');
                        if (count > 128) {
                            count -= 128;
                            if (count === 0 || x + count > width) throw new Error('Bad HDR run');
                            const v = bytes[pos++];
                            for (let i = 0; i < count; i++) out[(x++) * 4 + c] = v;
                        } else {
                            if (count === 0 || x + count > width) throw new Error('Bad HDR literal');
                            for (let i = 0; i < count; i++) out[(x++) * 4 + c] = bytes[pos++];
                        }
                    }
                }
                return pos;
            }
            // flat pixels, possibly with old-style RLE (1,1,1,n = repeat previous pixel)
            let x = 0, shift = 0;
            while (x < width) {
                if (pos + 4 > bytes.length) throw new Error('HDR data truncated');
                const r = bytes[pos], g = bytes[pos + 1], b = bytes[pos + 2], e = bytes[pos + 3];
                pos += 4;
                if (r === 1 && g === 1 && b === 1 && x > 0) {
                    const n = e << shift;
                    for (let i = 0; i < n && x < width; i++, x++) out.copyWithin(x * 4, (x - 1) * 4, x * 4);
                    shift += 8;
                } else {
                    out[x * 4] = r; out[x * 4 + 1] = g; out[x * 4 + 2] = b; out[x * 4 + 3] = e;
                    x++; shift = 0;
                }
            }
            return pos;
        }

        // Standard new-style RLE encoder (Greg Ward / Bruce Walter rgbe.c)
        function hdrEncodeScanline(px, width, chunks) {
            if (width < 8 || width >= 32768) { chunks.push(px.slice(0, width * 4)); return; }
            const out = [2, 2, width >> 8, width & 255];
            const chan = new Uint8Array(width);
            for (let c = 0; c < 4; c++) {
                for (let x = 0; x < width; x++) chan[x] = px[x * 4 + c];
                let cur = 0;
                while (cur < width) {
                    let begRun = cur, runCount = 0, oldRunCount = 0;
                    while (runCount < 4 && begRun < width) {
                        begRun += runCount;
                        oldRunCount = runCount;
                        runCount = 1;
                        while (begRun + runCount < width && runCount < 127 && chan[begRun] === chan[begRun + runCount]) runCount++;
                    }
                    if (oldRunCount > 1 && oldRunCount === begRun - cur) {
                        out.push(128 + oldRunCount, chan[cur]);
                        cur = begRun;
                    }
                    while (cur < begRun) {
                        let n = Math.min(begRun - cur, 128);
                        out.push(n);
                        for (let i = 0; i < n; i++) out.push(chan[cur + i]);
                        cur += n;
                    }
                    if (runCount >= 4) {
                        out.push(128 + runCount, chan[begRun]);
                        cur += runCount;
                    }
                }
            }
            chunks.push(new Uint8Array(out));
        }

        function rgbeToFloat(px, i, acc, j, weight) {
            const e = px[i + 3];
            if (!e) return;
            const f = Math.pow(2, e - 136) * weight;   // (mantissa + 0.5) / 256 * 2^(e-128)
            acc[j] += (px[i] + 0.5) * f; acc[j + 1] += (px[i + 1] + 0.5) * f; acc[j + 2] += (px[i + 2] + 0.5) * f;
        }

        function floatToRgbe(r, g, b, out, i) {
            const v = Math.max(r, g, b);
            if (v < 1e-32) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; return; }
            const e = Math.ceil(Math.log2(v) + 1e-9);
            const s = 256 / Math.pow(2, e);
            out[i] = Math.min(255, Math.floor(r * s)); out[i + 1] = Math.min(255, Math.floor(g * s)); out[i + 2] = Math.min(255, Math.floor(b * s));
            out[i + 3] = e + 128;
        }

        async function optimizeHdr(item, opts, setProgress) {
            const bytes = new Uint8Array(await item.file.arrayBuffer());
            const headText = bytesToLatin1(bytes.subarray(0, Math.min(bytes.length, 65536)));
            if (!/^#\?(RADIANCE|RGBE)/.test(headText)) skip('Not a Radiance HDR image (e.g. an ENVI/Analyze header) — kept original');
            const hdrEnd = headText.indexOf('\n\n');
            if (hdrEnd < 0) skip('Damaged HDR header — kept original');
            const header = headText.slice(0, hdrEnd);
            if (/FORMAT=32-bit_rle_xyze/.test(header)) skip('XYZ-encoded HDR is kept as-is');
            const resEnd = headText.indexOf('\n', hdrEnd + 2);
            const resLine = headText.slice(hdrEnd + 2, resEnd);
            const m = resLine.match(/^([-+])Y (\d+) ([-+])X (\d+)$/);
            if (!m) skip('Unusual HDR orientation — kept original');
            const height = +m[2], width = +m[4];
            let pos = resEnd + 1;

            // Target size
            // HDRIs are almost always RLE already, so size comes from resolution. Width caps:
            //   Low: lossless only · Balanced: 4K · Aggressive: 2K   (one step smaller with "Downscale" on)
            const cap = (opts.downscale ? { low: 4096, balanced: 2048, aggressive: 1024 } : { low: 0, balanced: 4096, aggressive: 2048 })[opts.preset];
            const scale = cap && width > cap ? cap / width : 1;
            const ow = Math.max(1, Math.round(width * scale)), oh = Math.max(1, Math.round(height * scale));
            const resized = ow !== width;
            setProgress.log(`hdr ${width}x${height}${resized ? ` → ${ow}x${oh}` : ''}, first scanline ${bytes[pos] === 2 && bytes[pos + 1] === 2 ? 'RLE' : 'flat'}`);

            const header2 = header.replace(/^(SOFTWARE|# ?Made with|# ?Created).*\n?/gmi, '') + '\nSOFTWARE=FileFit';
            const chunks = [new TextEncoder().encode(`${header2}\n\n${m[1]}Y ${oh} ${m[3]}X ${ow}\n`)];

            const row = new Uint8Array(width * 4);
            try {
                if (!resized) {
                    for (let y = 0; y < height; y++) {
                        pos = hdrDecodeScanline(bytes, pos, width, row);
                        hdrEncodeScanline(row, width, chunks);
                        if ((y & 63) === 0) { setProgress(5 + (y / height) * 90); await nextFrame(); }
                    }
                } else {
                    // streaming box filter: each input pixel adds to exactly one output pixel bucket
                    const acc = new Float64Array(ow * 3), cnt = new Float64Array(ow);
                    const colMap = new Int32Array(width);
                    for (let x = 0; x < width; x++) colMap[x] = Math.min(ow - 1, Math.floor(x * ow / width));
                    const outRow = new Uint8Array(ow * 4);
                    let curOut = 0;
                    const flush = () => {
                        for (let x = 0; x < ow; x++) {
                            const n = cnt[x] || 1;
                            floatToRgbe(acc[x * 3] / n, acc[x * 3 + 1] / n, acc[x * 3 + 2] / n, outRow, x * 4);
                        }
                        hdrEncodeScanline(outRow, ow, chunks);
                        acc.fill(0); cnt.fill(0);
                    };
                    for (let y = 0; y < height; y++) {
                        pos = hdrDecodeScanline(bytes, pos, width, row);
                        const ty = Math.min(oh - 1, Math.floor(y * oh / height));
                        while (ty > curOut) { flush(); curOut++; }
                        for (let x = 0; x < width; x++) { const o = colMap[x]; rgbeToFloat(row, x * 4, acc, o * 3, 1); cnt[o]++; }
                        if ((y & 63) === 0) { setProgress(5 + (y / height) * 90); await nextFrame(); }
                    }
                    while (curOut < oh) { flush(); curOut++; }
                }
            } catch (err) {
                skip(`Could not read this HDR (${err.message}) — kept original`);
            }

            const blob = new Blob(chunks, { type: 'image/vnd.radiance' });
            if (blob.size >= item.size * 0.99 && !resized) {
                skip(`Already RLE-compressed and ≤ ${cap || width}px wide — kept original` + (opts.preset === 'aggressive' && opts.downscale ? '' : '. Use Aggressive or “Downscale” to shrink it further'));
            }
            return { blob, outName: item.name, note: resized ? `Resized to ${ow}×${oh}` : 'Recompressed (lossless RLE)' };
        }

