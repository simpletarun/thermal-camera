<div align="center">

# 🔥 ThermalVision

### Your webcam becomes a thermal-style camera — in your browser, with zero uploads.

**Pick a palette. See heat. Find people and hot spots. See in the dark.**

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![WebGL](https://img.shields.io/badge/WebGL-shaders-990000) ![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 👀 What you get

```
┌──────────────────────────────────────────────┐
│ 🔥 ThermalVision                     ● LIVE  │
├──────────────────────────────────────────────┤
│ MEASURE            MAX   36.4°C   HOT ▣      │
│                    MIN   21.1°C   COLD ▢     │
│                    AVG   27.8°C              │
│                    ΔT    15.3 K    [P1 36.2°]│
│                                              │
│              ( live thermal view )           │
│                 + crosshair + spots          │
├──────────────────────────────────────────────┤
│ palettes │ night boost │ AI tracking │ ...   │
└──────────────────────────────────────────────┘
```

> Everything you see — the colors, the boxes, the temperatures — is computed **on your device**. No video is sent anywhere.

---

## 🚀 Start in 30 seconds

**Windows:** double-click **`start.bat`** → open **http://localhost:3000** → click **Enable Camera** → allow permission.

**Or manually:**

```bash
npm install
npm run dev
```

That's it. No API keys, no cloud account, no model download (the AI model is bundled in the repo).

> `localhost` is a secure context, so the browser allows camera access. For use from another device, serve over **HTTPS**.

---

## ✨ What can you do?

| I want to… | Use this |
|---|---|
| See heat as color | **10 palettes** — Ironbow, Rainbow, Grayscale, Lava, Night Vision and more |
| See in a dim or dark room | **Night Boost** — stacks many frames to pull out faint light |
| Find people or hot objects | **AI target tracking** — face boxes or heat-spot boxes with live temperatures |
| Read exact temperatures | **Measure panel** (MAX / MIN / AVG / ΔT), **crosshair**, and up to **3 click-to-place spots** |
| Trust the numbers | **2-point calibration** + emissivity correction |
| Catch a fever / overheat | **Alarm** — set a threshold, e.g. 37.5 °C, and the screen flashes |
| Keep a record | **Photo** (PNG) and **Record** (WebM / MP4) |
| Get a closer look | **Flip**, **Fullscreen**, **1× / 2× / 4× zoom**, **°C / °F** |

---

## 🎛 The three knobs that matter

### 1. Palette
Just a look — click any chip to change how heat is colored. Ironbow is the classic; Night Vision is green.

### 2. Night boost

| Level | When to use it |
|---|---|
| **Off** | Well-lit scenes. No frame stacking, sharpest motion. |
| **Auto** | Indoors or dusk. Balanced. |
| **Night** | Dim rooms. Strong gain and frame averaging. |
| **Deep Night** | Almost pitch black. Maximum averaging — moving objects may leave short trails. |

> No optical camera can see in true 0-lux darkness. Keep a tiny light source (LED, moon, phone screen) nearby.

### 3. AI target tracking

| Mode | What it does |
|---|---|
| **Off** | Clean view, no boxes. |
| **Heat spots** | Boxes the 3 hottest regions — people, animals, engines, lamps. |
| **Face screening** | Bundled on-device model boxes faces with a temperature chip per person. Falls back to heat tracking in the dark. |

> The AI status line tells you what's happening: `loading ai model…` → `ai ready`. If the model can't start, tracking continues as plain heat detection.

---

## 🌡 Make the temperatures mean something

Out of the box, temperatures are **estimates** based on the scene's brightness range. For useful readings, calibrate once:

1. Click **2-pt calibrate**.
2. Point the pulsing crosshair at something **cold** (ice water ≈ 0 °C) → enter its temperature → **Capture cold point**.
3. Point at something **hot** (your palm ≈ 33 °C) → enter it → **Capture hot point**.
4. Done — the scale is now anchored to your two references.

**Good to know:** changing **gain**, **integration** or **emissivity** clears the calibration, because those change what the sensor sees. A `calibrated · reset` chip shows the current state.

---

## 🧠 How it works (the short version)

1. **Capture** a webcam frame.
2. **Boost** it — average frames over time, amplify gain, and add motion-adaptive detail ("Night Boost").
3. **Map** brightness to a thermal color palette and draw the HUD: temperatures, boxes, scale bar, alarm.

All three steps are WebGL shaders plus a small amount of local JavaScript. The face detector runs locally too.

---

## 🛠 Project map

```text
src/app/page.tsx                  screen, controls wiring, calibration dialog
src/components/thermal/controls.tsx   all the buttons, sliders and toggles
src/lib/thermal/engine.ts         the whole engine: WebGL, analysis, AI, HUD, capture
src/lib/thermal/palettes.ts       10 palettes → 256-color lookup tables
public/models/                    bundled face-detection model (.tflite)
public/mediapipe/wasm/            bundled MediaPipe runtime
start.bat                         one-click launcher for Windows
Caddyfile                         reverse proxy used by the hosting platform
```

Prisma/SQLite files (`prisma/`, `db/`, `src/lib/db.ts`) are template scaffolding — the camera app itself doesn't use a database.

---

## 🆘 Something not right?

| Symptom | Try this |
|---|---|
| Camera button does nothing | Allow camera access in the browser's address bar, then reload. |
| Black screen | Another app may be using the camera. Close it and retry. |
| Camera denied | Check browser site permissions for `localhost`. |
| Temperature looks wrong | Run the 2-point calibration; check emissivity and the min/max range. |
| Rear camera looks mirrored | It shouldn't — only the front camera mirrors, by design. Reload if needed. |
| Dark scene is still black | Turn on Night Boost and add a tiny light source. 0 lux is invisible to any optical sensor. |
| `npm run build` fails on Windows | That script uses Unix `cp`. Use `npx next build` or Git Bash. |

---

## 🔒 Privacy

**100% local.** No backend, no uploads, no analytics, no CDN calls — the AI model and WebAssembly runtime ship with the app. Your camera feed never leaves the browser tab.

## ⚠️ Straight talk

This is **not real LWIR thermal hardware**. It infers apparent heat from visible light, so results depend on lighting, surfaces and calibration. It cannot see through walls — solids block infrared. Temperature readouts are estimates, not measurements for safety-critical decisions.

## 📄 License

MIT — see [LICENSE](LICENSE).
