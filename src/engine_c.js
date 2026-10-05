        // ---------- Video & audio ----------
        // 1) Mediabunny + WebCodecs: hardware-accelerated, fast. Modern containers & codecs.
        // 2) ffmpeg.wasm: software fallback for legacy formats (AVI, WMV, FLV, MPEG, WMA, AIFF…)
        //    and for codecs this browser can't decode/encode. Slower, but handles almost anything.
        let mediaChain = Promise.resolve();
        function withMediaLock(fn) {          // encoders work best one job at a time
            const run = mediaChain.then(fn, fn);
            mediaChain = run.catch(() => {});
            return run;
        }

        class NeedFallback extends Error {}
        const even = n => Math.max(2, Math.round(n / 2) * 2);
        const AUDIO_KBPS = { low: 192, balanced: 128, aggressive: 96 };
        const VIDEO_CRF = { low: 23, balanced: 27, aggressive: 31 };
        const videoCap = opts => opts.downscale ? (opts.preset === 'aggressive' ? 720 : 1080) : null;

        async function optimizeMedia(item, opts, setProgress) {
            const ext = item.extension;
            if (ext === 'ts') {
                const h = await readHead(item.file, 189);
                if (h[0] !== 0x47 || (h.length > 188 && h[188] !== 0x47)) skip('TypeScript/text file — kept original');
            }
            let reason = '';
            const group = groupForExt(ext);
            if (!group.legacy && ('AudioDecoder' in window || 'VideoDecoder' in window)) {
                setProgress.log('engine: webcodecs');
                try {
                    return await optimizeWithMediabunny(item, opts, setProgress);
                } catch (err) {
                    if (!(err instanceof NeedFallback)) throw err;
                    reason = err.message;
                    setProgress.log('fallback → ffmpeg: ' + reason);
                }
            } else setProgress.log(group.legacy ? 'engine: ffmpeg (legacy format)' : 'engine: ffmpeg (no WebCodecs)');
            return optimizeWithFfmpeg(item, opts, setProgress, reason);
        }

        async function optimizeWithMediabunny(item, opts, setProgress) {
            const ext = item.extension;
            let MB;
            try { MB = await loadLib('mediabunny'); } catch (_) { throw new NeedFallback('media engine unavailable'); }
            setProgress(8);

            const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(item.file) });
            try {
                return await convertWithMediabunny(MB, input, item, opts, setProgress);
            } finally {
                try { input.dispose(); } catch (_) {}
            }
        }

        async function convertWithMediabunny(MB, input, item, opts, setProgress) {
            const ext = item.extension;
            let vTrack, aTrack;
            try {
                await input.getFormat();
                vTrack = await input.getPrimaryVideoTrack();
                aTrack = await input.getPrimaryAudioTrack();
            } catch (_) {
                throw new NeedFallback('container not supported by WebCodecs path');
            }
            if (!vTrack && !aTrack) skip('No audio or video tracks found');

            const q = { low: MB.QUALITY_HIGH, balanced: MB.QUALITY_MEDIUM, aggressive: MB.QUALITY_LOW }[opts.preset];
            const audioKbps = AUDIO_KBPS[opts.preset] * 1000;
            let format, outExt, mime, video, audio, note = '';

            if (vTrack) {
                if (!('VideoEncoder' in window)) throw new NeedFallback('no WebCodecs video encoder');
                if (!(await vTrack.canDecode())) throw new NeedFallback(`${vTrack.codec || 'video'} not decodable here`);

                let w = vTrack.displayWidth, h = vTrack.displayHeight;
                const cap = videoCap(opts);
                let resized = false;
                if (cap && Math.min(w, h) > cap) {
                    const s = cap / Math.min(w, h);
                    w = even(w * s); h = even(h * s); resized = true;
                }
                // MP4/H.264 is the universal target. WebM inputs may stay WebM/VP9 if H.264 isn't encodable.
                const candidates = ext === 'webm' ? ['avc', 'vp9', 'av1'] : ['avc', 'hevc'];
                const vcodec = await MB.getFirstEncodableVideoCodec(candidates, { width: w, height: h, bitrate: q });
                if (!vcodec) throw new NeedFallback('no hardware H.264 encoder');

                video = { codec: vcodec, bitrate: q, forceTranscode: true, keyFrameInterval: 5 };
                if (resized) { Object.assign(video, { width: w, height: h, fit: 'contain' }); note = `Resized to ${w}×${h}. `; }
                setProgress.log(`video ${vTrack.codec} ${vTrack.displayWidth}x${vTrack.displayHeight} → ${vcodec}`);

                const useMp4 = vcodec === 'avc' || vcodec === 'hevc';
                if (aTrack) {
                    if (!(await aTrack.canDecode())) throw new NeedFallback(`${aTrack.codec || 'audio'} not decodable here`);
                    const acodec = await MB.getFirstEncodableAudioCodec(useMp4 ? ['aac', 'opus'] : ['opus'], {
                        numberOfChannels: aTrack.numberOfChannels, sampleRate: aTrack.sampleRate, bitrate: audioKbps
                    });
                    if (!acodec) throw new NeedFallback('no audio encoder');
                    audio = { codec: acodec, bitrate: audioKbps };
                }
                if (useMp4) { format = new MB.Mp4OutputFormat({ fastStart: 'in-memory' }); outExt = 'mp4'; mime = 'video/mp4'; }
                else { format = new MB.WebMOutputFormat(); outExt = 'webm'; mime = 'video/webm'; note += `Encoded as ${vcodec.toUpperCase()}. `; }
                if (vcodec === 'hevc') note += 'Encoded as HEVC. ';
            } else {
                if (!(await aTrack.canDecode())) throw new NeedFallback(`${aTrack.codec || 'audio'} not decodable here`);
                const encOpts = { numberOfChannels: aTrack.numberOfChannels, sampleRate: aTrack.sampleRate, bitrate: audioKbps };

                if (['ogg', 'oga', 'opus', 'webm', 'weba'].includes(ext) && await MB.canEncodeAudio('opus', encOpts)) {
                    format = new MB.OggOutputFormat(); outExt = ext === 'opus' ? 'opus' : 'ogg'; mime = 'audio/ogg';
                    audio = { codec: 'opus', bitrate: audioKbps, forceTranscode: true };
                } else if (['m4a', 'm4b', 'aac', 'mp4'].includes(ext) && await MB.canEncodeAudio('aac', encOpts)) {
                    format = new MB.Mp4OutputFormat({ fastStart: 'in-memory' }); outExt = ext === 'm4b' ? 'm4b' : 'm4a'; mime = 'audio/mp4';
                    audio = { codec: 'aac', bitrate: audioKbps, forceTranscode: true };
                } else {
                    if (!(await MB.canEncodeAudio('mp3'))) {
                        try {
                            const enc = await loadLib('mp3enc');
                            if (!window.__mp3Registered) { enc.registerMp3Encoder(); window.__mp3Registered = true; }
                        } catch (_) { throw new NeedFallback('MP3 encoder unavailable'); }
                    }
                    format = new MB.Mp3OutputFormat(); outExt = 'mp3'; mime = 'audio/mpeg';
                    audio = { codec: 'mp3', bitrate: audioKbps, forceTranscode: true };
                    if (ext !== 'mp3') note = `Converted ${ext.toUpperCase()} → MP3 ${audioKbps / 1000} kbps. `;
                }
            }

            const output = new MB.Output({ format, target: new MB.BufferTarget() });
            const conversion = await MB.Conversion.init({
                input, output, video, audio,
                tracks: 'primary',
                showWarnings: false,
                ...(opts.stripMeta ? { tags: {} } : {})
            });
            if (!conversion.isValid || (vTrack && conversion.discardedTracks.some(d => d.track.type === 'video'))) {
                throw new NeedFallback(conversion.discardedTracks.map(d => d.reason).join(', ') || 'unsupported codec');
            }

            conversion.onProgress = p => setProgress(10 + p * 88);
            try {
                await conversion.execute();
            } catch (err) {
                throw new NeedFallback('WebCodecs encode failed: ' + (err.message || err));
            }

            const blob = new Blob([output.target.buffer], { type: mime });
            if (blob.size >= item.size) skip('Already efficiently encoded — kept original');
            return { blob, outName: replaceExtension(item.name, outExt), note: note.trim() };
        }

        // ----- ffmpeg.wasm (software) -----
        let ffmpegPromise = null;
        function getFfmpeg(setStage) {
            if (!ffmpegPromise) {
                ffmpegPromise = (async () => {
                    setStage('Downloading video engine (≈10 MB, once)…');
                    await loadLib('ffmpeg');
                    const base = libBase() + 'ffmpeg/';
                    const wasm = await fetchMaybeGzip(base + 'ffmpeg-core.wasm.gz');
                    const wasmURL = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
                    const ff = new FFmpegWASM.FFmpeg();
                    await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL });
                    return ff;
                })().catch(err => { ffmpegPromise = null; throw err; });
            }
            return ffmpegPromise;
        }

        let ffSeq = 0;
        async function optimizeWithFfmpeg(item, opts, setProgress, reason) {
            if (typeof WebAssembly === 'undefined' || !('Worker' in window)) skip('This browser cannot run the video engine');
            let ff;
            try { ff = await getFfmpeg(setProgress.stage); }
            catch (err) {
                console.error(err);
                skip(`Video engine unavailable${location.protocol === 'file:' ? ' when opened from disk — use the hosted site' : ''} — kept original`);
            }
            setProgress.stage('Encoding (software encoder — slower)…');
            setProgress(10);

            const isVideo = item.typeCategory === 'video';
            const dir = `/job${++ffSeq}`;
            const inPath = `${dir}/${item.file.name}`;
            const kbps = AUDIO_KBPS[opts.preset];
            let outExt, mime, note = '';
            const args = ['-hide_banner', '-nostdin', '-y', '-i', inPath];

            if (isVideo) {
                outExt = 'mp4'; mime = 'video/mp4';
                args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(VIDEO_CRF[opts.preset]),
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', kbps + 'k', '-movflags', '+faststart');
                const cap = videoCap(opts);
                // keep aspect, only shrink when the short side exceeds the cap, keep dimensions even
                const scale = cap
                    ? `scale='if(gte(iw,ih),-2,min(${cap},iw))':'if(gte(iw,ih),min(${cap},ih),-2)',scale=trunc(iw/2)*2:trunc(ih/2)*2`
                    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
                args.push('-vf', scale);
            } else {
                const toAac = ['m4a', 'm4b', 'aac'].includes(item.extension);
                outExt = toAac ? 'm4a' : 'mp3'; mime = toAac ? 'audio/mp4' : 'audio/mpeg';
                args.push('-map', '0:a:0', '-vn', '-c:a', toAac ? 'aac' : 'libmp3lame', '-b:a', kbps + 'k');
                if (!toAac && item.extension !== 'mp3') note = `Converted ${item.extension.toUpperCase()} → MP3 ${kbps} kbps. `;
            }
            if (opts.stripMeta) args.push('-map_metadata', '-1');
            const outPath = `/out${ffSeq}.${outExt}`;
            args.push(outPath);

            const logs = [];
            const onLog = ({ message }) => { logs.push(message); if (logs.length > 60) logs.shift(); };
            const onProgress = ({ progress }) => { if (progress >= 0 && progress <= 1) setProgress(10 + progress * 88); };
            ff.on('log', onLog);
            ff.on('progress', onProgress);
            let data = null, code = -1;
            try {
                await ff.createDir(dir);
                await ff.mount('WORKERFS', { files: [item.file] }, dir);   // streams from disk — no full copy in memory
                try {
                    code = await ff.exec(args);
                } catch (err) {
                    // core crashed (e.g. out of memory) — throw the instance away so the next file gets a fresh one
                    try { ff.terminate(); } catch (_) {}
                    ffmpegPromise = null;
                    throw new Error('Video engine ran out of memory on this file');
                }
                if (code === 0) data = await ff.readFile(outPath);
            } finally {
                ff.off('log', onLog);
                ff.off('progress', onProgress);
                try { await ff.unmount(dir); } catch (_) {}
                try { await ff.deleteDir(dir); } catch (_) {}
                try { await ff.deleteFile(outPath); } catch (_) {}
            }
            if (code !== 0 || !data) {
                console.warn('ffmpeg log:\n' + logs.join('\n'));
                setProgress.log(`ffmpeg exit ${code}: ` + logs.slice(-4).join(' / '));
                if (logs.some(l => /Invalid data found when processing input|moov atom not found|could not find codec parameters/i.test(l))) {
                    skip('Unrecognized or damaged media file — kept original');
                }
                const tail = logs.reverse().find(l => /error|invalid|not supported|could not/i.test(l)) || '';
                throw new Error('Could not convert this file' + (tail ? `: ${tail.trim().slice(0, 120)}` : ''));
            }
            const blob = new Blob([data], { type: mime });
            if (blob.size >= item.size) skip('Already efficiently encoded — kept original');
            if (isVideo && item.extension !== 'mp4') note += `Converted ${item.extension.toUpperCase()} → MP4. `;
            return { blob, outName: replaceExtension(item.name, outExt), note: note.trim() };
        }

        // ---------- Router ----------
        async function runOptimizer(item, opts, setProgress) {
            const ext = item.extension;
            const group = groupForExt(ext);
            if (!group) {
                const kept = KEPT_AS_IS[ext];
                skip(kept ? kept.why : 'No optimizer for this file type — kept original');
            }
            setProgress.log('handler: ' + group.title);
            if (group.media) {
                if (!opts.media) skip('Video & audio optimization is turned off in settings');
                return withMediaLock(() => optimizeMedia(item, opts, setProgress));
            }
            return group.run(item, opts, setProgress);
        }

