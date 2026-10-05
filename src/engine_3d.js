        // ---------- FBX ----------
        // Binary FBX: every geometry/animation array is re-compressed with zlib level 9 (the FBX spec's own
        // array compression, read by Autodesk SDK, Blender, Unity, Unreal, three.js), embedded JPEG textures
        // are recompressed. Node tree, names and values stay identical.
        // ASCII FBX: trailing zeros in numbers are trimmed (1.000000 → 1) — values unchanged.
        const FBX_ARRAY_ELEM = { f: 4, d: 8, l: 8, i: 4, b: 1 };

        function fbxParse(bytes) {
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = dv.getUint32(23, true);
            const wide = version >= 7500;
            const rd = o => wide ? Number(dv.getBigUint64(o, true)) : dv.getUint32(o, true);
            const recHead = wide ? 25 : 13;

            function readProps(start, end) {
                const props = [];
                let p = start;
                while (p < end) {
                    const t = String.fromCharCode(bytes[p]);
                    const s = p; p++;
                    if (FBX_ARRAY_ELEM[t]) {
                        const len = dv.getUint32(p, true), enc = dv.getUint32(p + 4, true), clen = dv.getUint32(p + 8, true);
                        p += 12;
                        props.push({ t, len, enc, data: bytes.subarray(p, p + clen) });
                        p += clen;
                    } else if (t === 'S' || t === 'R') {
                        const len = dv.getUint32(p, true);
                        p += 4;
                        props.push({ t, data: bytes.subarray(p, p + len) });
                        p += len;
                    } else {
                        const size = { Y: 2, C: 1, I: 4, F: 4, D: 8, L: 8 }[t];
                        if (!size) throw new Error('Unknown FBX property type ' + t);
                        p += size;
                        props.push({ t, raw: bytes.subarray(s, p) });
                    }
                }
                if (p !== end) throw new Error('FBX property list size mismatch');
                return props;
            }

            function readNode(o) {
                const end = rd(o), nProps = rd(o + (wide ? 8 : 4)), propLen = rd(o + (wide ? 16 : 8));
                const nameLen = bytes[o + recHead - 1];
                if (end === 0) return { node: null, next: o + recHead };
                const name = bytesToLatin1(bytes.subarray(o + recHead, o + recHead + nameLen));
                const pStart = o + recHead + nameLen, pEnd = pStart + propLen;
                const props = readProps(pStart, pEnd);
                if (props.length !== nProps) throw new Error('FBX property count mismatch');
                const node = { name, props, children: [], nested: end > pEnd };
                let c = pEnd;
                if (node.nested) {
                    while (c < end) {
                        const r = readNode(c);
                        c = r.next;
                        if (!r.node) break;
                        node.children.push(r.node);
                    }
                    if (c !== end) throw new Error('FBX node size mismatch in ' + name);
                }
                return { node, next: end };
            }

            const nodes = [];
            let o = 27;
            while (o < bytes.length) {
                const r = readNode(o);
                o = r.next;
                if (!r.node) break;
                nodes.push(r.node);
            }
            return { version, wide, nodes, footer: bytes.subarray(o) };
        }

        async function fbxOptimizeProps(nodes, opts, pako, stats, parentName = '') {
            for (const n of nodes) {
                for (let i = 0; i < n.props.length; i++) {
                    const p = n.props[i];
                    if (FBX_ARRAY_ELEM[p.t]) {
                        const rawLen = p.len * FBX_ARRAY_ELEM[p.t];
                        if (rawLen < 128) continue;
                        const raw = p.enc === 1 ? pako.inflate(p.data) : p.data;
                        if (raw.length !== rawLen) throw new Error('FBX array length mismatch');
                        const comp = pako.deflate(raw, { level: 9 });
                        if (comp.length < p.data.length) { stats.saved += p.data.length - comp.length; p.data = comp; p.enc = 1; stats.arrays++; }
                    } else if (p.t === 'R' && n.name === 'Content' && parentName === 'Video' && p.data.length > 20 * 1024 && p.data[0] === 0xFF && p.data[1] === 0xD8) {
                        const re = await reencodeJpegBytes(p.data, opts.jpegQ);
                        if (re && re.length < p.data.length * 0.9) { p.data = re; stats.textures++; }
                    }
                }
                await fbxOptimizeProps(n.children, opts, pako, stats, n.name);
            }
        }

        function fbxWrite(model) {
            const { wide, version, nodes } = model;
            const chunks = [];
            let offset = 0;
            const push = b => { chunks.push(b); offset += b.length; };
            const recHead = wide ? 25 : 13;
            const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };

            function propBytes(p) {
                if (p.raw) return [p.raw];
                if (FBX_ARRAY_ELEM[p.t]) {
                    const h = new Uint8Array(13), dv = new DataView(h.buffer);
                    h[0] = p.t.charCodeAt(0); dv.setUint32(1, p.len, true); dv.setUint32(5, p.enc, true); dv.setUint32(9, p.data.length, true);
                    return [h, p.data];
                }
                const h = new Uint8Array(5); h[0] = p.t.charCodeAt(0); new DataView(h.buffer).setUint32(1, p.data.length, true);
                return [h, p.data];
            }
            function writeNode(n) {
                const name = new TextEncoder().encode(n.name);
                const pb = n.props.flatMap(propBytes);
                const propLen = pb.reduce((a, b) => a + b.length, 0);
                const head = new Uint8Array(recHead + name.length);
                const start = offset;
                push(head);
                pb.forEach(push);
                if (n.nested) { n.children.forEach(writeNode); push(new Uint8Array(recHead)); }
                const dv = new DataView(head.buffer);
                if (wide) {
                    dv.setBigUint64(0, BigInt(offset), true); dv.setBigUint64(8, BigInt(n.props.length), true); dv.setBigUint64(16, BigInt(propLen), true);
                } else {
                    dv.setUint32(0, offset, true); dv.setUint32(4, n.props.length, true); dv.setUint32(8, propLen, true);
                }
                head[recHead - 1] = name.length;
                head.set(name, recHead);
                if (!wide && offset > 0xFFFFFFFF) throw new Error('FBX too large');
                return start;
            }

            const magic = new Uint8Array(27);
            magic.set(new TextEncoder().encode('Kaydara FBX Binary  '), 0);
            magic[20] = 0; magic[21] = 0x1A; magic[22] = 0;
            new DataView(magic.buffer).setUint32(23, version, true);
            push(magic);
            nodes.forEach(writeNode);
            push(new Uint8Array(recHead));                       // top-level null record

            // Footer: id, 4 zeros, padding to 16-byte alignment, version, 120 zeros, magic
            const f = model.footer;
            if (f.length >= 16 + 16) {
                push(f.subarray(0, 16));
                push(new Uint8Array(4));
                let pad = ((offset + 15) & ~15) - offset;
                if (pad === 0) pad = 16;
                push(new Uint8Array(pad));
                push(u32(version));
                push(new Uint8Array(120));
                push(f.subarray(f.length - 16));
            } else push(f);
            return chunks;
        }

        async function optimizeFbx(item, opts, setProgress) {
            const head = bytesToLatin1(await readHead(item.file, 23));
            if (head.startsWith('Kaydara FBX Binary')) {
                const bytes = new Uint8Array(await item.file.arrayBuffer());
                const pako = await loadLib('pako');
                setProgress(15);
                let model;
                try { model = fbxParse(bytes); }
                catch (err) { setProgress.log('parse: ' + err.message); skip('Could not parse this FBX — kept original'); }
                setProgress.log(`fbx binary v${model.version}, ${model.nodes.length} top-level nodes`);
                const stats = { arrays: 0, textures: 0, saved: 0 };
                await fbxOptimizeProps(model.nodes, opts, pako, stats);
                setProgress(80);
                const blob = new Blob(fbxWrite(model), { type: 'application/octet-stream' });
                // round-trip safety check: re-parse what we wrote
                try { fbxParse(new Uint8Array(await blob.arrayBuffer())); }
                catch (err) { throw new Error('FBX self-check failed: ' + err.message); }
                if (blob.size >= item.size) skip('FBX arrays are already compressed — kept original');
                const notes = [];
                if (stats.arrays) notes.push(`${stats.arrays} geometry/animation arrays compressed`);
                if (stats.textures) notes.push(`${stats.textures} embedded texture(s) recompressed`);
                return { blob, outName: item.name, note: notes.join(' · ') };
            }
            // ASCII FBX
            const { text } = await readUtf8(item.file);
            if (!/^\s*;\s*FBX/i.test(text) && !/FBXHeaderExtension/.test(text.slice(0, 5000))) skip('Unrecognized FBX file — kept original');
            setProgress.log('fbx ascii');
            const out = withStash(text, [/"(?:[^"\\]|\\.)*"/g, /;[^\n]*/g], s => s
                .replace(/(\d)\.(\d*?)0+(?![\d])/g, (m, a, frac) => frac ? `${a}.${frac}` : a)   // 1.500000 → 1.5, 2.000 → 2
                .replace(/[ \t]+$/gm, ''));
            const blob = new Blob([out], { type: 'text/plain' });
            if (blob.size >= item.size) skip('Already compact — kept original');
            return { blob, outName: item.name, note: 'ASCII FBX: numbers shortened (values unchanged). Export as binary FBX for much smaller files.' };
        }

        // ---------- STEP (ISO 10303-21) ----------
        // Exact, lossless rewrite: comments and whitespace removed, REAL numbers written in their shortest
        // exact form (1.500000000000000E+001 → 15.). Strings untouched. Opens in every CAD tool.
        function shortestStepReal(m) {
            const r = m.match(/^(-?)(\d+)\.(\d*)(?:E([+-]?\d+))?$/i);
            if (!r) return m;
            const sign = r[1];
            let all = r[2] + r[3];
            let pointPos = r[2].length + (r[4] ? parseInt(r[4], 10) : 0);   // decimal point position inside `all`
            while (all.length > 1 && all[0] === '0') { all = all.slice(1); pointPos--; }
            while (all.length > 1 && all[all.length - 1] === '0') { all = all.slice(0, -1); }
            if (all === '0') return '0.';
            let plain = null;
            if (pointPos <= 0 && pointPos > -6) plain = '0.' + '0'.repeat(-pointPos) + all;
            else if (pointPos > 0 && pointPos < all.length) plain = all.slice(0, pointPos) + '.' + all.slice(pointPos);
            else if (pointPos >= all.length && pointPos - all.length < 6) plain = all + '0'.repeat(pointPos - all.length) + '.';
            const sci = all[0] + '.' + all.slice(1) + 'E' + (pointPos - 1);
            return sign + (plain && plain.length <= sci.length ? plain : sci);
        }

        async function optimizeStep(item) {
            const { text } = await readUtf8(item.file);
            if (!/^\s*ISO-10303-21\s*;/.test(text)) skip('Not a STEP (ISO 10303-21) file — kept original');
            const out = withStash(text, [/'(?:[^']|'')*'/g], s => s
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/[ \t\r\n]+/g, '')
                .replace(/;/g, ';\n')
                .replace(/(^|[(,=])(-?\d+\.\d*(?:E[+-]?\d+)?)(?=[),;])/gi, (m, pre, num) => pre + shortestStepReal(num)));
            const blob = new Blob([out], { type: 'model/step' });
            if (blob.size >= item.size) skip('Already compact — kept original');
            return { blob, outName: item.name, note: 'Lossless: numbers & whitespace compacted' };
        }

        // ---------- PLY (ASCII → binary little-endian) ----------
        const PLY_TYPES = {
            char: ['Int8', 1], int8: ['Int8', 1], uchar: ['Uint8', 1], uint8: ['Uint8', 1],
            short: ['Int16', 2], int16: ['Int16', 2], ushort: ['Uint16', 2], uint16: ['Uint16', 2],
            int: ['Int32', 4], int32: ['Int32', 4], uint: ['Uint32', 4], uint32: ['Uint32', 4],
            float: ['Float32', 4], float32: ['Float32', 4], double: ['Float64', 8], float64: ['Float64', 8]
        };

        async function optimizePly(item) {
            const head = bytesToLatin1(await readHead(item.file, 512));
            if (!head.startsWith('ply')) skip('Not a PLY file — kept original');
            if (!/format ascii/.test(head)) skip('Binary PLY is already compact');
            const { text } = await readUtf8(item.file);
            const hEnd = text.indexOf('end_header');
            if (hEnd < 0) skip('Damaged PLY header — kept original');
            const headerLines = text.slice(0, hEnd).split(/\r?\n/);
            const elements = [];
            for (const line of headerLines) {
                const t = line.trim().split(/\s+/);
                if (t[0] === 'element') elements.push({ name: t[1], count: +t[2], props: [] });
                else if (t[0] === 'property') {
                    const el = elements[elements.length - 1];
                    if (!el) skip('Damaged PLY header — kept original');
                    if (t[1] === 'list') {
                        if (!PLY_TYPES[t[2]] || !PLY_TYPES[t[3]]) skip('Unsupported PLY type — kept original');
                        el.props.push({ list: true, ct: PLY_TYPES[t[2]], it: PLY_TYPES[t[3]] });
                    } else {
                        if (!PLY_TYPES[t[1]]) skip('Unsupported PLY type — kept original');
                        el.props.push({ list: false, it: PLY_TYPES[t[1]] });
                    }
                }
            }
            const body = text.slice(text.indexOf('\n', hEnd) + 1);
            const tok = body.split(/\s+/).filter(Boolean);
            let ti = 0;
            // size pass
            let size = 0;
            for (const el of elements) for (let r = 0; r < el.count; r++) for (const p of el.props) {
                if (p.list) { const n = +tok[ti++]; size += p.ct[1] + n * p.it[1]; ti += n; }
                else { size += p.it[1]; ti++; }
            }
            if (ti > tok.length) skip('PLY data shorter than its header says — kept original');
            const buf = new ArrayBuffer(size), dv = new DataView(buf);
            let o = 0; ti = 0;
            const put = (type, v) => { dv['set' + type[0]](o, type[0].startsWith('Float') ? parseFloat(v) : parseInt(v, 10), true); o += type[1]; };
            for (const el of elements) for (let r = 0; r < el.count; r++) for (const p of el.props) {
                if (p.list) { const n = +tok[ti]; put(p.ct, tok[ti++]); for (let k = 0; k < n; k++) put(p.it, tok[ti++]); }
                else put(p.it, tok[ti++]);
            }
            const newHeader = text.slice(0, hEnd).replace(/format ascii 1\.0/, 'format binary_little_endian 1.0') + 'end_header\n';
            const blob = new Blob([newHeader, buf], { type: 'application/octet-stream' });
            if (blob.size >= item.size) skip('Binary version would not be smaller — kept original');
            return { blob, outName: item.name, note: 'ASCII → binary PLY (lossless)' };
        }

