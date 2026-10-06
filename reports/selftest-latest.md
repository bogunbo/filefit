# Self-test — 2026-10-06T09:57:51.852Z

**Chrome 154 / Linux** · app v4.1 · 27s · ✅ done: 35 · ⚪ skipped: 2

Capabilities: `{"webcodecs":true,"audioDecoder":true,"compressionStream":true,"wasm":true,"cores":2,"memoryGB":8,"h264Encode":true,"h264Decode":true,"aacEncode":false}`

| | File | Before | After | Saved | Note / trace |
|---|---|---|---|---|---|
| ✅ | alpha.png | 284.6 KB | 36.3 KB | 87% |  <br><sub>handler: Photos & images</sub> |
| ⚪ | anim.webp | 64.6 KB | – |  | Animated image — kept original so the animation survives <br><sub>handler: Photos & images</sub> |
| ✅ | app.js | 5.0 KB | 1.9 KB | 62% |  <br><sub>handler: Web code</sub> |
| ✅ | ascii.stl | 887.5 KB | 175.9 KB | 80% | ASCII → binary STL <br><sub>handler: 3D meshes</sub> |
| ✅ | bigint.json | 0.1 KB | 0.1 KB | 23% |  <br><sub>handler: Data & markup</sub> |
| ✅ | book.epub | 892.0 KB | 610.4 KB | 32% |  <br><sub>handler: E-books & comics</sub> |
| ✅ | bundle.tar | 1.20 MB | 94.3 KB | 92% | Packed as .tar.gz <br><sub>handler: Archives</sub> |
| ✅ | clip.flv | 1.32 MB | 200.3 KB | 85% | Converted FLV → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | clip.mp4 | 5.89 MB | 1.60 MB | 73% |  <br><sub>handler: Video › engine: webcodecs › video avc 1920x1080 → avc</sub> |
| ✅ | clip.webm | 1.64 MB | 596.3 KB | 64% |  <br><sub>handler: Video › engine: webcodecs › video vp9 1280x720 → avc</sub> |
| ✅ | clip.wmv | 1.44 MB | 195.1 KB | 87% | Converted WMV → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | cmyk_jpeg.pdf | 2.33 MB | 96.4 KB | 96% |  <br><sub>handler: PDF › ghostscript rc=0 out=99554</sub> |
| ✅ | comments.css | 0.1 KB | 0.0 KB | 52% |  <br><sub>handler: Web code</sub> |
| ✅ | compact.svg | 7.9 KB | 0.3 KB | 96% |  <br><sub>handler: Vector graphics</sub> |
| ✅ | config.glb | 2.77 MB | 1.38 MB | 50% |  <br><sub>handler: 3D models — glTF binary</sub> |
| ✅ | data.json | 35.6 KB | 13.1 KB | 63% |  <br><sub>handler: Data & markup</sub> |
| ✅ | doc.pdf | 891.1 KB | 84.5 KB | 91% |  <br><sub>handler: PDF › ghostscript rc=0 out=87528</sub> |
| ✅ | edge.css | 0.1 KB | 0.1 KB | 20% |  <br><sub>handler: Web code</sub> |
| ✅ | edge.html | 0.1 KB | 0.1 KB | 5% |  <br><sub>handler: Web code</sub> |
| ✅ | font.ttf | 741.9 KB | 252.8 KB | 66% | Converted to WOFF2 web font <br><sub>handler: Fonts</sub> |
| ✅ | form.pdf | 1.06 MB | 244.2 KB | 77% | 1 image(s) recompressed · form fields preserved <br><sub>handler: PDF › form fields detected → pdf-lib only › pdf-lib pass</sub> |
| ✅ | icon.svg | 7.9 KB | 0.2 KB | 98% |  <br><sub>handler: Vector graphics</sub> |
| ✅ | mesh.obj | 332.5 KB | 303.2 KB | 9% | Coordinates rounded to 5 decimals <br><sub>handler: 3D meshes</sub> |
| ✅ | office_export.pdf | 274.8 KB | 70.8 KB | 74% |  <br><sub>handler: PDF › ghostscript rc=0 out=74820</sub> |
| ✅ | old.avi | 129.7 KB | 56.7 KB | 56% | Converted AVI → MP4. <br><sub>handler: Video — legacy & camera formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | photo.jpg | 870.3 KB | 143.1 KB | 84% |  <br><sub>handler: Photos & images</sub> |
| ✅ | report.docx | 920.0 KB | 244.6 KB | 73% | 1 embedded image(s) recompressed <br><sub>handler: Microsoft Office & OpenDocument</sub> |
| ✅ | scene.blend | 161.1 KB | 5.5 KB | 97% | Gzip-compressed — opens directly in Blender <br><sub>handler: Blender</sub> |
| ✅ | shot.png | 263.3 KB | 52.6 KB | 80% |  <br><sub>handler: Photos & images</sub> |
| ⚪ | signed.pdf | 891.2 KB | – |  | Digitally signed PDF — kept original so the signature stays valid <br><sub>handler: PDF</sub> |
| ✅ | small.bmp | 351.6 KB | 18.2 KB | 95% |  <br><sub>handler: Photos & images</sub> |
| ✅ | song.m4a | 168.0 KB | 94.8 KB | 44% | Converted M4A → MP3 128 kbps. <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | song.mp3 | 242.4 KB | 94.8 KB | 61% |  <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | song.wav | 1.01 MB | 94.4 KB | 91% | Converted WAV → MP3 128 kbps. <br><sub>handler: Audio › engine: webcodecs</sub> |
| ✅ | text_fonts.pdf | 40.8 KB | 35.0 KB | 14% |  <br><sub>handler: PDF › ghostscript rc=0 out=34781 › text layer repaired on 1 font(s) › pdf-lib pass</sub> |
| ✅ | tone.wma | 169.3 KB | 78.8 KB | 53% | Converted WMA → MP3 128 kbps. <br><sub>handler: Audio — legacy formats › engine: ffmpeg (legacy format)</sub> |
| ✅ | track.gpx | 207.0 KB | 174.7 KB | 16% |  <br><sub>handler: Data & markup</sub> |

## Console errors
- `Failed to load resource: the server responded with a status of 404 ()`