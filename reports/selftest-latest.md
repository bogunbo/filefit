# Self-test — 2026-10-06T12:45:59.321Z

**Chrome 154 / Linux** · app v4.2 · 59s · ✅ done: 44 · ⚪ skipped: 3

Capabilities: `{"webcodecs":true,"audioDecoder":true,"compressionStream":true,"wasm":true,"cores":4,"memoryGB":16,"h264Encode":true,"h264Decode":true,"aacEncode":false}`

| | File | Before | After | Saved | Note / trace |
|---|---|---|---|---|---|
| ✅ | BoxTextured.gltf | 9.6 KB | 5.7 KB | 41% | Converted to GLB (single binary file) <br><sub>handler: glTF / GLB</sub> |
| ✅ | Samba_Dancing.fbx | 3.51 MB | 3.37 MB | 4% | 805 geometry/animation arrays compressed <br><sub>handler: FBX › fbx binary v7400, 11 top-level nodes</sub> |
| ✅ | alpha.png | 279.0 KB | 36.3 KB | 87% |  <br><sub>handler: Photos & images</sub> |
| ⚪ | anim.webp | 59.0 KB | – |  | Animated image — kept original so the animation survives <br><sub>handler: Photos & images</sub> |
| ✅ | app.js | 5.0 KB | 1.9 KB | 62% |  <br><sub>handler: Web code</sub> |
| ✅ | as1_pe_203.stp | 136.5 KB | 128.1 KB | 6% | Lossless: numbers & whitespace compacted <br><sub>handler: CAD — STEP</sub> |
| ✅ | ascii.stl | 887.5 KB | 175.9 KB | 80% | ASCII → binary STL <br><sub>handler: 3D meshes</sub> |
| ✅ | bigint.json | 0.1 KB | 0.1 KB | 23% |  <br><sub>handler: Data & markup</sub> |
| ✅ | book.epub | 892.0 KB | 610.4 KB | 32% |  <br><sub>handler: E-books & comics</sub> |
| ✅ | bundle.tar | 1.20 MB | 94.3 KB | 92% | Packed as .tar.gz <br><sub>handler: Archives</sub> |
| ✅ | clip.flv | 1.32 MB | 200.3 KB | 85% | Converted FLV → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | clip.mp4 | 5.88 MB | 1.60 MB | 73% |  <br><sub>handler: Video › engine: webcodecs › video avc 1920x1080 → avc</sub> |
| ✅ | clip.webm | 1.64 MB | 595.0 KB | 64% |  <br><sub>handler: Video › engine: webcodecs › video vp9 1280x720 → avc</sub> |
| ✅ | clip.wmv | 1.44 MB | 195.1 KB | 87% | Converted WMV → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | cmyk_jpeg.pdf | 2.33 MB | 96.4 KB | 96% |  <br><sub>handler: PDF › ghostscript rc=0 out=99554</sub> |
| ✅ | comments.css | 0.1 KB | 0.0 KB | 52% |  <br><sub>handler: Web code</sub> |
| ✅ | compact.svg | 0.3 KB | 0.3 KB | 15% |  <br><sub>handler: Vector graphics</sub> |
| ✅ | config.glb | 2.77 MB | 1.38 MB | 50% |  <br><sub>handler: glTF / GLB</sub> |
| ✅ | data.json | 35.6 KB | 13.1 KB | 63% |  <br><sub>handler: Data & markup</sub> |
| ✅ | doc.pdf | 891.1 KB | 84.5 KB | 91% |  <br><sub>handler: PDF › ghostscript rc=0 out=87528</sub> |
| ✅ | dolphins.ply | 43.6 KB | 31.6 KB | 27% | ASCII → binary PLY (lossless) <br><sub>handler: 3D meshes</sub> |
| ✅ | edge.css | 0.1 KB | 0.1 KB | 20% |  <br><sub>handler: Web code</sub> |
| ✅ | edge.html | 0.1 KB | 0.1 KB | 5% |  <br><sub>handler: Web code</sub> |
| ✅ | font.ttf | 741.9 KB | 252.8 KB | 66% | Converted to WOFF2 web font <br><sub>handler: Fonts</sub> |
| ✅ | form.pdf | 1.06 MB | 244.2 KB | 77% | 1 image(s) recompressed · form fields preserved <br><sub>handler: PDF › form fields detected → pdf-lib only › pdf-lib pass</sub> |
| ✅ | icon.svg | 0.3 KB | 0.1 KB | 56% |  <br><sub>handler: Vector graphics</sub> |
| ✅ | male02.obj | 453.7 KB | 428.7 KB | 6% | Coordinates rounded to 5 decimals <br><sub>handler: 3D meshes</sub> |
| ⚪ | memorial.hdr | 1.28 MB | – |  | Already RLE-compressed and ≤ 4096px wide — kept original. Use Aggressive or “Downscale” to shrink it further <br><sub>handler: HDR environment maps › hdr 512x768, first scanline RLE</sub> |
| ✅ | mesh.obj | 332.5 KB | 303.2 KB | 9% | Coordinates rounded to 5 decimals <br><sub>handler: 3D meshes</sub> |
| ✅ | mixamo.fbx | 2.94 MB | 2.81 MB | 4% | 861 geometry/animation arrays compressed <br><sub>handler: FBX › fbx binary v7700, 11 top-level nodes</sub> |
| ✅ | office_export.pdf | 274.8 KB | 70.8 KB | 74% |  <br><sub>handler: PDF › ghostscript rc=0 out=74820</sub> |
| ✅ | old.avi | 124.1 KB | 56.7 KB | 54% | Converted AVI → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | photo.jpg | 864.6 KB | 143.1 KB | 83% |  <br><sub>handler: Photos & images</sub> |
| ✅ | report.docx | 920.0 KB | 244.6 KB | 73% | 1 embedded image(s) recompressed <br><sub>handler: Microsoft Office & OpenDocument</sub> |
| ✅ | scene.blend | 161.1 KB | 5.5 KB | 97% | Gzip-compressed — opens directly in Blender <br><sub>handler: Blender</sub> |
| ✅ | shot.png | 257.7 KB | 52.6 KB | 80% |  <br><sub>handler: Photos & images</sub> |
| ⚪ | signed.pdf | 891.2 KB | – |  | Digitally signed PDF — kept original so the signature stays valid <br><sub>handler: PDF</sub> |
| ✅ | slotted_disk.stl | 79.0 KB | 14.1 KB | 82% | ASCII → binary STL <br><sub>handler: 3D meshes</sub> |
| ✅ | small.bmp | 351.6 KB | 18.2 KB | 95% |  <br><sub>handler: Photos & images</sub> |
| ✅ | song.m4a | 162.2 KB | 94.8 KB | 42% | Converted M4A → MP3 128 kbps. <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | song.mp3 | 236.8 KB | 94.8 KB | 60% |  <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | song.wav | 1.01 MB | 94.4 KB | 91% | Converted WAV → MP3 128 kbps. <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | text_fonts.pdf | 40.8 KB | 35.0 KB | 14% |  <br><sub>handler: PDF › ghostscript rc=0 out=34781 › text layer repaired on 1 font(s) › pdf-lib pass</sub> |
| ✅ | tone.wma | 169.3 KB | 78.8 KB | 53% | Converted WMA → MP3 128 kbps. <br><sub>handler: Audio — legacy formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | track.gpx | 207.0 KB | 174.7 KB | 16% |  <br><sub>handler: Data & markup</sub> |
| ✅ | vCube.fbx | 12.2 KB | 12.1 KB | 1% | 4 geometry/animation arrays compressed <br><sub>handler: FBX › fbx binary v7400, 11 top-level nodes</sub> |
| ✅ | venice_flat.hdr | 2.00 MB | 1.33 MB | 33% | Recompressed (lossless RLE) <br><sub>handler: HDR environment maps › hdr 1024x512, first scanline flat</sub> |

## Console errors
- `Failed to load resource: the server responded with a status of 404 ()`