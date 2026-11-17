# ThermalVision — Thermal-Style Camera in Your Browser

Turn a webcam into a thermal-imaging-style viewer with FLIR-inspired palettes, live temperature readouts, on-device AI target tracking, and Night Boost frame stacking for near-dark scenes. **All processing happens locally in the browser — video never leaves your device.**

> **Important:** this is *simulated* thermal imaging. It estimates apparent heat from visible-light luminance; it is not true long-wave infrared (LWIR) hardware. No camera — including military thermal — can see through walls: solids block infrared. Temperature values are estimates unless you calibrate with known references.

## Features

- **10 thermal palettes** — Ironbow, Rainbow HC, Grayscale, Hot Metal, Glowbow, Arctic, Lava, White Hot, Black Hot, Night Vision.
- **Night Boost** — Off / Auto / Night / Deep Night presets stack up to ~25 frames to suppress noise and amplify faint light. Hardware gain/exposure is applied where supported and restored on exit.
- **AI target tracking** — a bundled MediaPipe face detector (no CDN) boxes faces with per-person temperature chips, with connected-component heat-blob tracking as a fallback and in "Heat spots" mode.
- **Measure HUD** — Fluke-style MAX / MIN / AVG / ΔT panel, center-spot temperature, hot/cold markers, scale bar, crosshair, isotherms, heat trails, sensor grain, timestamp.
- **2-point calibration** — anchor the scale with a cold and a hot reference; emissivity correction and °C / °F display included.
- **High-temperature alarm** — blinking overlay and toast when the hottest target crosses a threshold (e.g. 37.5 °C for fever screening).
- **Capture & controls** — PNG snapshots, WebM/MP4 recording, camera flip, fullscreen, 1×/2×/4× zoom, up to 3 click-to-place measurement spots.

## Tech stack

Next.js 16 (Turbopack, App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · WebGL fragment shaders · MediaPipe Tasks Vision · Prisma (scaffolding only) · SQLite.

## Quick start

**Requirements:** Node.js 20+, a browser with WebGL 2 and camera support, and a webcam.

**Windows:** double-click `start.bat`. It checks for Node, installs dependencies if needed, and starts the dev server.

**Manual:**

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and click **Enable Camera**. `localhost` is a secure context, so browser camera permission works. For access from another device, serve over HTTPS.

Other scripts: `npm run build` (standalone build), `npm run start` (production, requires [Bun](https://bun.sh)), `npm run lint`, `npm run db:push`.

> Note: the packaged `build` script uses Unix `cp`; on Windows use `npx next build` directly or run it from Git Bash.

## Usage

1. **Enable Camera** and allow browser permission. The camera indicator turns off when the stream stops or the page unmounts.
2. Choose a **palette**, a **Night boost** level, and an **AI target tracking** mode (off / heat spots / face screening). The AI model downloads nothing — it is bundled in `public/`.
3. **Click anywhere on the video** to drop a measurement spot (max 3; use **Clear spots** to reset).
4. For realistic readings, run **2-pt calibrate**: aim the crosshair at a known cold reference (e.g. ice water ≈ 0 °C), then a known hot one (e.g. palm ≈ 33 °C). Changing gain, integration or emissivity clears stale calibration.
5. Enable **Alarm**, set a threshold, and the hottest target will flash the screen and raise a toast.
6. Use **Photo** / **Record** to download captures. Files are saved locally by the browser.

## Project structure

```text
src/
  app/
    page.tsx                  camera UI, state, calibration flow
    layout.tsx                metadata, fonts, toaster
    api/route.ts              placeholder API route
  components/
    thermal/controls.tsx      palette / boost / detection / capture controls
    ui/                       shadcn/ui primitives
  hooks/                      toast + mobile helpers
  lib/
    thermal/engine.ts         WebGL pipeline, analysis, AI tracking, HUD, capture
    thermal/palettes.ts       palette definitions and LUT builder
    db.ts                     Prisma client (unused by the camera)
prisma/schema.prisma          SQLite User/Post scaffolding
public/
  models/                     bundled face-detection model
  mediapipe/wasm/             bundled MediaPipe runtime
start.bat                     one-click dev launcher for Windows
Caddyfile                     reverse proxy with XTransformPort support
```

## Privacy & accuracy

Everything runs in your browser. There is no backend upload, no analytics, and no CDN fetch for the AI model. Readings are luminance-derived estimates — black-body calibration, emissivity and environmental conditions all affect accuracy. Night Boost needs at least a tiny light source; in true 0-lux darkness no optical sensor can see.

## License

MIT — see [LICENSE](LICENSE).
