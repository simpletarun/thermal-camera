import { buildLut, getPalette } from './palettes'

/* ---------------------------------- types --------------------------------- */

export type DetectMode = 'off' | 'hot' | 'faces'
export type DetectState = 'off' | 'loading' | 'ready' | 'failed'

/** A tracked measurement target, normalized to the display frame (y: 0 = top). */
export interface TargetBox {
  x: number
  y: number
  w: number
  h: number
  /** smoothed raw luminance (0..1) of the target's hottest region */
  raw: number
  /** stable tracking id */
  id: number
}

export interface ThermalParams {
  paletteId: string
  /** digital sensor gain 1..10 */
  gain: number
  /** temporal integration 0..1 (0 = off, 1 = deep night starlight mode) */
  integration: number
  /** extra per-pixel responsiveness where motion is detected 0..1 */
  motionBoost: number
  /** gamma/contrast exponent 0.5..2 */
  contrast: number
  mirror: boolean
  crosshair: boolean
  scaleBar: boolean
  markers: boolean
  grain: boolean
  /** reference temperature range for the scale bar (used until 2-point calibration exists) */
  minTemp: number
  maxTemp: number
  /** emissivity correction 0.10..1.00 (1.00 = matte black-body reference) */
  emissivity: number
  /** thermal inertia — warm objects leave slowly decaying heat trails */
  inertia: boolean
  /** isotherm contour bands */
  isotherms: boolean
  /** high-temperature alarm overlay */
  alarmEnabled: boolean
  /** alarm threshold in °C */
  alarmTemp: number
  /** display unit */
  unit: 'C' | 'F'
  /** digital zoom 1 | 2 | 4 */
  zoom: number
  /** two-point calibration anchors: raw luminance -> °C */
  calA: { lum: number; temp: number } | null
  calB: { lum: number; temp: number } | null
  /** AI target tracking: off | hottest heat sources | face screening */
  detectMode: DetectMode
  /** Fluke-style MAX/MIN/AVG/ΔT measurement panel */
  statsPanel: boolean
  /** detail enhancement (unsharp mask) — recovers edge detail in night scenes */
  sharpen: boolean
}

export interface ThermalStats {
  fps: number
  width: number
  height: number
  centerTemp: number
  hotTemp: number
  coldTemp: number
  avgTemp: number
  /** number of AI-tracked targets in the current detection mode */
  targets: number
  /** true while the scene temperature alarm is active */
  alarm: boolean
}

export type NightLevel = 'auto' | 'off' | 'night' | 'deep'

export const DEFAULT_PARAMS: ThermalParams = {
  paletteId: 'ironbow',
  gain: 1,
  integration: 0.35,
  motionBoost: 0.6,
  contrast: 1,
  mirror: true,
  crosshair: true,
  scaleBar: true,
  markers: true,
  grain: true,
  minTemp: 18,
  maxTemp: 42,
  emissivity: 1,
  inertia: false,
  isotherms: false,
  alarmEnabled: false,
  alarmTemp: 35,
  unit: 'C',
  zoom: 1,
  calA: null,
  calB: null,
  detectMode: 'hot',
  statsPanel: true,
  sharpen: true,
}

/* --------------------------------- shaders -------------------------------- */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** Pass 1: luminance extraction + motion-adaptive temporal integration (starlight mode). */
const FRAG_INTEGRATE = `
precision highp float;
uniform sampler2D uVideo;
uniform sampler2D uPrev;
uniform float uAlpha;
uniform float uMotionBoost;
uniform float uMirror;
uniform float uGain;
uniform float uZoom;
varying vec2 vUv;

void main() {
  vec2 uv = (vUv - 0.5) / uZoom + 0.5;
  uv = vec2(mix(uv.x, 1.0 - uv.x, uMirror), uv.y);
  vec3 c = texture2D(uVideo, uv).rgb;
  float lum = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)) * uGain, 0.0, 1.0);
  float prev = texture2D(uPrev, vUv).r;
  float motion = abs(lum - prev);
  float gate = smoothstep(0.02, 0.12, motion);
  float alpha = clamp(uAlpha + gate * uMotionBoost * 0.9, uAlpha, 1.0);
  gl_FragColor = vec4(mix(prev, lum, alpha), lum, 0.0, 1.0);
}
`

/** Pass 1b: thermal inertia — heat memory that rises instantly and decays slowly. */
const FRAG_INERTIA = `
precision highp float;
uniform sampler2D uMem;
uniform sampler2D uAccum;
uniform float uDecay;
varying vec2 vUv;

void main() {
  float lum = texture2D(uAccum, vUv).r;
  float mem = texture2D(uMem, vUv).r;
  gl_FragColor = vec4(max(lum, mem * uDecay), 0.0, 0.0, 1.0);
}
`

/** Pass 2: auto-range stretch + thermal palette + isotherms + alarm + sensor grain. */
const FRAG_GRADE = `
precision highp float;
uniform sampler2D uAccum;
uniform sampler2D uMem;
uniform sampler2D uLut;
uniform vec2 uRange;
uniform float uContrast;
uniform float uGrain;
uniform float uTime;
uniform float uInertia;
uniform float uIso;
uniform float uAlarm;
uniform float uAlarmV;
uniform vec2 uTexel;
uniform float uSharp;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453);
}

void main() {
  float lumA = texture2D(uAccum, vUv).r;
  if (uSharp > 0.0) {
    float ln = texture2D(uAccum, vUv + vec2(0.0, uTexel.y)).r;
    float ls = texture2D(uAccum, vUv - vec2(0.0, uTexel.y)).r;
    float le = texture2D(uAccum, vUv + vec2(uTexel.x, 0.0)).r;
    float lw = texture2D(uAccum, vUv - vec2(uTexel.x, 0.0)).r;
    lumA = clamp(lumA + (lumA * 4.0 - ln - ls - le - lw) * uSharp, 0.0, 1.0);
  }
  float lumM = texture2D(uMem, vUv).r;
  float lum = mix(lumA, lumM, uInertia);
  float v = clamp((lum - uRange.x) / max(uRange.y - uRange.x, 1e-4), 0.0, 1.0);
  v = pow(v, uContrast);
  vec3 col = texture2D(uLut, vec2(v, 0.5)).rgb;
  if (uIso > 0.5) {
    float f = fract(v * 12.0);
    float line = 1.0 - smoothstep(0.0, 0.045, min(f, 1.0 - f));
    col = mix(col, vec3(1.0), line * 0.75);
  }
  if (uAlarm > 0.5 && v > uAlarmV) {
    float blink = 0.62 + 0.38 * sin(uTime * 9.0);
    col = mix(col, vec3(1.0, 0.07, 0.12), blink);
  }
  col = clamp(col + (hash(gl_FragCoord.xy) - 0.5) * uGrain, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Downsample pass for CPU-side scene analysis. */
const FRAG_DOWN = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`

/* --------------------------------- helpers -------------------------------- */

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('Failed to create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('Shader compile error: ' + log)
  }
  return sh
}

function makeProgram(gl: WebGLRenderingContext, fsSrc: string): WebGLProgram {
  const prog = gl.createProgram()
  if (!prog) throw new Error('Failed to create program')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(prog))
  }
  return prog
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

const MONO_FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const MONO_FONT_SM = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const MONO_FONT_B = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** Minimal structural typings for the MediaPipe face detector (dynamically imported). */
interface MpDetection {
  boundingBox?: { originX: number; originY: number; width: number; height: number }
  categories?: Array<{ score?: number }>
}
interface MpFaceDetectorLike {
  detectForVideo(image: HTMLCanvasElement, timestamp: number): { detections?: MpDetection[] }
  close?: () => void
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/* ---------------------------------- engine --------------------------------- */

interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

export class ThermalEngine {
  private glCanvas: HTMLCanvasElement
  private hudCanvas: HTMLCanvasElement
  private container: HTMLElement
  private gl: WebGLRenderingContext
  private hudCtx: CanvasRenderingContext2D

  private video = document.createElement('video')
  private stream: MediaStream | null = null

  private progIntegrate!: WebGLProgram
  private progInertia!: WebGLProgram
  private progGrade!: WebGLProgram
  private progDown!: WebGLProgram
  private locs = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>()
  private aPos = new Map<WebGLProgram, number>()

  private quadBuf!: WebGLBuffer
  private videoTex!: WebGLTexture
  private lutTex!: WebGLTexture
  private accumA: Target | null = null
  private accumB: Target | null = null
  private memA: Target | null = null
  private memB: Target | null = null
  private tiny: Target | null = null
  private readBuf = new Uint8Array(96 * 54 * 4)

  /* AI target tracking state */
  private det: Target | null = null
  private detBuf = new Uint8Array(320 * 180 * 4)
  private detCanvas = document.createElement('canvas')
  private vidDetCanvas = document.createElement('canvas')
  private detTick = 0
  private detTs = 0
  private detErr = 0
  private faceMiss = 0
  private detector: MpFaceDetectorLike | null = null
  private detectState: DetectState = 'off'
  private faces: TargetBox[] = []
  private blobs: TargetBox[] = []
  private tgtId = 0
  private avgRaw = 0.5
  private alarmActive = false
  private lastFaceSource: 'video' | 'luma' | 'none' = 'none'

  private lutCacheId = ''
  private lutColors: Uint8Array | null = null

  private params: ThermalParams = { ...DEFAULT_PARAMS }
  private lo = 0
  private hi = 1
  private spotRaw = 0
  private spotRawSm = 0.5
  private spots: Array<{ x: number; y: number; raw: number }> = []
  private calibrating = false
  private hotPt = { x: 0.7, y: 0.3 }
  private coldPt = { x: 0.3, y: 0.7 }
  private hotPtSm = { x: 0.7, y: 0.3 }
  private coldPtSm = { x: 0.3, y: 0.7 }
  private hotRaw = 0
  private coldRaw = 0

  private raf = 0
  private running = false
  private lastVideoTime = -1
  private analyzeCounter = 0
  private fpsFrames = 0
  private fpsTime = performance.now()
  private fps = 0
  private statsTime = 0

  private hudW = 0
  private hudH = 0
  private resizeObs: ResizeObserver | null = null

  private recorder: MediaRecorder | null = null
  private recChunks: Blob[] = []
  private recCanvas: HTMLCanvasElement | null = null
  private recCtx: CanvasRenderingContext2D | null = null
  private disposing = false

  facing: 'user' | 'environment' = 'user'
  /** sensor gain/exposure captured before deep-night overrides, restored on exit */
  private prevConstraints: { gain?: number; exposureTime?: number } | null = null
  /** calibration anchors invalidated by a gain/integration/emissivity change */
  private staleCal: { a: ThermalParams['calA']; b: ThermalParams['calB'] } | null = null
  onStats?: (s: ThermalStats) => void
  onError?: (e: Error) => void
  onCapture?: () => void
  onRecordStop?: () => void
  onCameraReady?: (w: number, h: number) => void
  onSpots?: (count: number) => void
  onDetectStatus?: (state: DetectState) => void
  /** rising edge of the scene temperature alarm (throttled inside the engine) */
  onAlarm?: (tempC: number) => void

  constructor(glCanvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement, container: HTMLElement) {
    this.glCanvas = glCanvas
    this.hudCanvas = hudCanvas
    this.container = container
    const gl = glCanvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) throw new Error('WebGL is not supported in this browser')
    this.gl = gl
    const ctx = hudCanvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser')
    this.hudCtx = ctx

    this.setupGl()
    this.video.muted = true
    this.video.playsInline = true
    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__THERMAL_DEBUG = () => this.debugState()
    }
    this.onGlClick = this.onGlClick.bind(this)
    glCanvas.addEventListener('click', this.onGlClick)
    this.resizeObs = new ResizeObserver(() => this.layout())
    this.resizeObs.observe(container)
  }

  /* ------------------------------ GL setup ------------------------------ */

  private setupGl() {
    const gl = this.gl
    this.progIntegrate = makeProgram(gl, FRAG_INTEGRATE)
    this.progInertia = makeProgram(gl, FRAG_INERTIA)
    this.progGrade = makeProgram(gl, FRAG_GRADE)
    this.progDown = makeProgram(gl, FRAG_DOWN)

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    this.quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    for (const prog of [this.progIntegrate, this.progInertia, this.progGrade, this.progDown]) {
      const loc = gl.getAttribLocation(prog, 'aPos')
      this.aPos.set(prog, loc)
    }

    this.videoTex = this.makeTex()
    this.lutTex = this.makeTex()

    this.rebuildLut()
    this.lo = 0
    this.hi = 1
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('Failed to create texture')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return tex
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl
    const tex = this.makeTex()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()
    if (!fbo) throw new Error('Failed to create framebuffer')
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo, w, h }
  }

  private destroyTarget(t: Target | null) {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    this.gl.deleteFramebuffer(t.fbo)
  }

  private uni(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.locs.get(prog)
    if (!m) {
      m = {}
      this.locs.set(prog, m)
    }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(prog, name)
    return m[name]
  }

  private drawQuad(prog: WebGLProgram) {
    const gl = this.gl
    const loc = this.aPos.get(prog)!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private rebuildLut() {
    const def = getPalette(this.params.paletteId)
    const lut = buildLut(def)
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
    this.lutCacheId = this.params.paletteId
    this.lutColors = lut
  }

  /* ------------------------------ camera ------------------------------ */

  async start(facing: 'user' | 'environment' = this.facing): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API unavailable. A secure (HTTPS) context is required.')
    }
    this.facing = facing
    this.stopStream()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
    } catch (e) {
      this.stopStream()
      throw e
    }
    this.stream = stream
    this.video.srcObject = stream
    this.prevConstraints = null

    try {
      await new Promise<void>((resolve, reject) => {
        const v = this.video
        let timer = 0
        const onReady = () => {
          v.removeEventListener('loadeddata', onReady)
          clearTimeout(timer)
          resolve()
        }
        v.addEventListener('loadeddata', onReady)
        v.play().catch(() => {})
        timer = window.setTimeout(() => {
          v.removeEventListener('loadeddata', onReady)
          reject(new Error('Camera stream timed out'))
        }, 10000)
      })
    } catch (e) {
      // release the camera so the hardware indicator turns off
      this.stopStream()
      this.video.srcObject = null
      throw e
    }

    const track = stream.getVideoTracks()[0]
    const settings = track.getSettings()
    const w = settings.width ?? this.video.videoWidth ?? 1280
    const h = settings.height ?? this.video.videoHeight ?? 720

    this.destroyTarget(this.accumA)
    this.destroyTarget(this.accumB)
    this.accumA = this.makeTarget(w, h)
    this.accumB = this.makeTarget(w, h)

    this.destroyTarget(this.memA)
    this.destroyTarget(this.memB)
    this.memA = this.makeTarget(w, h)
    this.memB = this.makeTarget(w, h)

    // medium-resolution luminance target used by the AI face detector
    const dw = 320
    const dh = Math.max(2, Math.round((dw / w) * h))
    this.destroyTarget(this.det)
    this.det = this.makeTarget(dw, dh)
    this.detBuf = new Uint8Array(dw * dh * 4)
    this.detCanvas.width = dw
    this.detCanvas.height = dh
    this.faces = []
    this.blobs = []

    const glCanvas = this.glCanvas
    glCanvas.width = Math.min(w, 1920)
    glCanvas.height = Math.round((glCanvas.width / w) * h)

    this.lastVideoTime = -1
    this.layout()
    this.applyNightConstraints()
    this.onCameraReady?.(w, h)

    if (!this.running) {
      this.running = true
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  async flipCamera(): Promise<void> {
    const prev = this.facing
    const next = prev === 'user' ? 'environment' : 'user'
    try {
      await this.start(next)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      try {
        await this.start(prev)
      } catch {
        // no camera left — stop rendering so the last frame can't pass for a live feed
        this.running = false
        cancelAnimationFrame(this.raf)
        const gl = this.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height)
      }
      this.onError?.(err)
      throw err
    }
  }

  /**
   * Best-effort: ask the camera driver for maximum analog gain / exposure
   * when the user enables deep night modes. Silently ignored if unsupported.
   */
  async applyNightConstraints(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0]
    if (!track) return
    try {
      const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>
      const deep = this.params.integration > 0.6
      const c: Record<string, unknown> = {}
      const gainCaps = caps.gain as { min?: number; max?: number } | undefined
      const expCaps = caps.exposureTime as { min?: number; max?: number } | undefined
      const modeCaps = caps.exposureMode as string[] | undefined
      if (deep) {
        if (!this.prevConstraints) {
          const s = track.getSettings() as Record<string, unknown>
          this.prevConstraints = {
            gain: s.gain as number | undefined,
            exposureTime: s.exposureTime as number | undefined,
          }
        }
        if (gainCaps?.max != null) c.gain = gainCaps.max
        if (expCaps?.max != null) c.exposureTime = Math.min(expCaps.max, 30000)
        if (modeCaps?.includes('manual')) c.exposureMode = 'manual'
      } else {
        // leaving deep night: put the sensor back where the driver had it
        const prev = this.prevConstraints
        this.prevConstraints = null
        if (prev?.gain != null) c.gain = prev.gain
        if (prev?.exposureTime != null) c.exposureTime = prev.exposureTime
        if (!prev && this.params.integration > 0.5 && gainCaps?.max != null) {
          c.gain = Math.min(gainCaps.max, (gainCaps.max - (gainCaps.min ?? 0)) * 0.5 + (gainCaps.min ?? 0))
        }
        if (modeCaps?.includes('continuous')) c.exposureMode = 'continuous'
      }
      if (Object.keys(c).length > 0) {
        await track.applyConstraints({ advanced: [c] } as MediaTrackConstraints)
      }
    } catch {
      /* hardware doesn't support manual controls — digital pipeline still applies */
    }
  }

  /* ------------------------------ params ------------------------------ */

  setParams(p: ThermalParams) {
    const prev = this.params
    const integrationChanged = p.integration !== prev.integration
    const detectChanged = p.detectMode !== prev.detectMode
    // calibration anchors only hold for the gain/integration/emissivity they were taken at
    if (p.gain !== prev.gain || integrationChanged || p.emissivity !== prev.emissivity) {
      this.staleCal = { a: p.calA, b: p.calB }
    }
    const next = { ...p }
    if (this.staleCal && p.calA === this.staleCal.a) next.calA = null
    if (this.staleCal && p.calB === this.staleCal.b) next.calB = null
    this.params = next
    if (p.paletteId !== this.lutCacheId) this.rebuildLut()
    if (integrationChanged && this.stream) void this.applyNightConstraints()
    if (detectChanged) {
      if (p.detectMode !== 'faces') {
        this.faces = []
      } else if (this.detectState === 'failed') {
        // allow one retry when the user re-enables face screening
        this.detectState = 'off'
      }
    }
  }

  /** Front camera mirrors like a mirror; the rear camera must not. */
  private get mirrorActive(): boolean {
    return this.params.mirror && this.facing === 'user'
  }

  /* ------------------------------ layout ------------------------------ */

  private layout() {
    const rect = this.container.getBoundingClientRect()
    const cw = rect.width
    const ch = rect.height
    if (cw < 2 || ch < 2) return
    const vw = this.glCanvas.width || 1280
    const vh = this.glCanvas.height || 720
    const scale = Math.max(cw / vw, ch / vh)
    const cssW = Math.round(vw * scale)
    const cssH = Math.round(vh * scale)

    for (const c of [this.glCanvas, this.hudCanvas]) {
      c.style.width = `${cssW}px`
      c.style.height = `${cssH}px`
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.hudCanvas.width = Math.round(cssW * dpr)
    this.hudCanvas.height = Math.round(cssH * dpr)
    this.hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.hudW = cssW
    this.hudH = cssH
  }

  /* ------------------------------ render loop ------------------------------ */

  private loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)

    const gl = this.gl
    const video = this.video
    if (video.readyState < 2) return

    // FPS accounting
    this.fpsFrames++
    const now = performance.now()
    if (now - this.fpsTime >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime))
      this.fpsFrames = 0
      this.fpsTime = now
    }

    const newFrame = video.currentTime !== this.lastVideoTime
    if (newFrame) {
      this.lastVideoTime = video.currentTime

      // upload camera frame
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      } catch {
        return
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

      // pass 1: integrate (ping-pong)
      const src = this.accumA
      const dst = this.accumB
      if (src && dst) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.useProgram(this.progIntegrate)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
        gl.uniform1i(this.uni(this.progIntegrate, 'uVideo'), 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        gl.uniform1i(this.uni(this.progIntegrate, 'uPrev'), 1)
        gl.uniform1f(this.uni(this.progIntegrate, 'uAlpha'), clamp(1 - this.params.integration * 0.96, 0.04, 1))
        gl.uniform1f(this.uni(this.progIntegrate, 'uMotionBoost'), this.params.motionBoost)
        gl.uniform1f(this.uni(this.progIntegrate, 'uMirror'), this.mirrorActive ? 1 : 0)
        gl.uniform1f(this.uni(this.progIntegrate, 'uGain'), this.params.gain)
        gl.uniform1f(this.uni(this.progIntegrate, 'uZoom'), this.params.zoom)
        this.drawQuad(this.progIntegrate)
        this.accumA = dst
        this.accumB = src
      }

      // pass 1b: thermal inertia (heat memory, ping-pong)
      const memSrc = this.memA
      const memDst = this.memB
      const fresh = this.accumA
      if (memSrc && memDst && fresh) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, memDst.fbo)
        gl.viewport(0, 0, memDst.w, memDst.h)
        gl.useProgram(this.progInertia)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, memSrc.tex)
        gl.uniform1i(this.uni(this.progInertia, 'uMem'), 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, fresh.tex)
        gl.uniform1i(this.uni(this.progInertia, 'uAccum'), 1)
        gl.uniform1f(this.uni(this.progInertia, 'uDecay'), 0.982)
        this.drawQuad(this.progInertia)
        this.memA = memDst
        this.memB = memSrc
      }

      if (++this.analyzeCounter % 2 === 0) this.analyze()
      this.maybeDetect()
    }

    // pass 2: grade to screen
    const src = this.accumA
    const mem = this.memA
    if (src && mem) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height)
      gl.useProgram(this.progGrade)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform1i(this.uni(this.progGrade, 'uAccum'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, mem.tex)
      gl.uniform1i(this.uni(this.progGrade, 'uMem'), 1)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex)
      gl.uniform1i(this.uni(this.progGrade, 'uLut'), 2)
      gl.uniform2f(this.uni(this.progGrade, 'uRange'), this.lo, Math.max(this.hi, this.lo + 0.04))
      gl.uniform1f(this.uni(this.progGrade, 'uContrast'), this.params.contrast)
      const grain = this.params.grain ? 0.035 + 0.012 * this.params.gain : 0
      gl.uniform1f(this.uni(this.progGrade, 'uGrain'), grain)
      gl.uniform1f(this.uni(this.progGrade, 'uTime'), (performance.now() % 100000) / 1000)
      gl.uniform1f(this.uni(this.progGrade, 'uInertia'), this.params.inertia ? 1 : 0)
      gl.uniform1f(this.uni(this.progGrade, 'uIso'), this.params.isotherms ? 1 : 0)
      gl.uniform1f(this.uni(this.progGrade, 'uAlarm'), this.params.alarmEnabled ? 1 : 0)
      const alarmRaw = this.rawForTemp(this.params.alarmTemp)
      const alarmV = clamp((alarmRaw - this.lo) / Math.max(this.hi - this.lo, 0.04), 0, 1)
      gl.uniform1f(this.uni(this.progGrade, 'uAlarmV'), alarmV)
      gl.uniform2f(this.uni(this.progGrade, 'uTexel'), 1 / (src.w || 1), 1 / (src.h || 1))
      gl.uniform1f(this.uni(this.progGrade, 'uSharp'), this.params.sharpen ? 0.6 : 0)
      this.drawQuad(this.progGrade)
    }

    this.drawHud()

    if (this.recorder && this.recording && this.recCanvas && this.recCtx) {
      this.recCtx.drawImage(this.glCanvas, 0, 0, this.recCanvas.width, this.recCanvas.height)
      this.recCtx.drawImage(this.hudCanvas, 0, 0, this.recCanvas.width, this.recCanvas.height)
    }

    if (now - this.statsTime >= 500) {
      this.statsTime = now
      this.emitStats()
    }
  }

  /* ------------------------------ analysis ------------------------------ */

  private analyze() {
    const gl = this.gl
    const src = this.accumA
    const tiny = this.tiny
    if (!src || !tiny) {
      if (!tiny) {
        this.tiny = this.makeTarget(96, 54)
        return
      }
      return
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, tiny.fbo)
    gl.viewport(0, 0, tiny.w, tiny.h)
    gl.useProgram(this.progDown)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    gl.uniform1i(this.uni(this.progDown, 'uTex'), 0)
    this.drawQuad(this.progDown)

    gl.readPixels(0, 0, tiny.w, tiny.h, gl.RGBA, gl.UNSIGNED_BYTE, this.readBuf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const n = tiny.w * tiny.h
    const hist = new Uint32Array(256)
    let minV = 255
    let maxV = 0
    let minI = 0
    let maxI = 0
    for (let i = 0; i < n; i++) {
      const v = this.readBuf[i * 4]
      hist[v]++
      if (v < minV) {
        minV = v
        minI = i
      }
      if (v > maxV) {
        maxV = v
        maxI = i
      }
    }

    // percentile range (2%..98%) — auto gain / auto exposure emulation
    const loCount = n * 0.02
    const hiCount = n * 0.98
    let cum = 0
    let loT = 0
    let hiT = 255
    for (let b = 0; b < 256; b++) {
      cum += hist[b]
      if (cum >= loCount) {
        loT = b
        break
      }
    }
    cum = 0
    for (let b = 0; b < 256; b++) {
      cum += hist[b]
      if (cum >= hiCount) {
        hiT = b
        break
      }
    }
    if (hiT - loT < 10) {
      const mid = (loT + hiT) / 2
      loT = clamp(mid - 10, 0, 245)
      hiT = clamp(mid + 10, 10, 255)
    }

    const k = 0.14
    this.lo += (loT / 255 - this.lo) * k
    this.hi += (hiT / 255 - this.hi) * k

    this.hotRaw = maxV
    this.coldRaw = minV

    // scene average luminance (for the AVG readout)
    let acc = 0
    for (let i = 0; i < n; i++) acc += this.readBuf[i * 4]
    this.avgRaw = acc / n / 255

    // hot / cold marker positions (display coords, y origin bottom in GL)
    this.hotPt = { x: ((maxI % tiny.w) + 0.5) / tiny.w, y: (Math.floor(maxI / tiny.w) + 0.5) / tiny.h }
    this.coldPt = { x: ((minI % tiny.w) + 0.5) / tiny.w, y: (Math.floor(minI / tiny.w) + 0.5) / tiny.h }
    this.smoothPt(this.hotPtSm, this.hotPt)
    this.smoothPt(this.coldPtSm, this.coldPt)

    // center spot: 3x3 average (accum coordinates, independent of zoom)
    const cx0 = Math.floor(tiny.w / 2)
    const cy0 = Math.floor(tiny.h / 2)
    let sum = 0
    let cnt = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xi = clamp(cx0 + dx, 0, tiny.w - 1)
        const yi = clamp(cy0 + dy, 0, tiny.h - 1)
        sum += this.readBuf[(yi * tiny.w + xi) * 4]
        cnt++
      }
    }
    this.spotRaw = sum / cnt / 255
    this.spotRawSm += (this.spotRaw - this.spotRawSm) * 0.25

    // user-placed spots (display coords == accum coords: mirror/zoom are baked into the buffer)
    for (const s of this.spots) {
      const xi = clamp(Math.round(s.x * tiny.w - 0.5), 0, tiny.w - 1)
      const yi = clamp(Math.round((1 - s.y) * tiny.h - 0.5), 0, tiny.h - 1)
      const raw = this.readBuf[(yi * tiny.w + xi) * 4] / 255
      s.raw += (raw - s.raw) * 0.3
    }

    // multi-source heat blobs for AI target tracking + per-face temperatures
    if (this.params.detectMode !== 'off') {
      this.computeBlobs()
      for (const f of this.faces) this.sampleBoxMax(f)
    }
  }

  private smoothPt(sm: { x: number; y: number }, target: { x: number; y: number }) {
    const d = Math.hypot(sm.x - target.x, sm.y - target.y)
    if (d > 0.3) {
      sm.x = target.x
      sm.y = target.y
    } else {
      sm.x += (target.x - sm.x) * 0.3
      sm.y += (target.y - sm.y) * 0.3
    }
  }

  /* --------------------------- AI target tracking --------------------------- */

  private isAlarmHot(): boolean {
    return this.params.alarmEnabled && this.rawToTemp(this.hotRaw / 255) >= this.params.alarmTemp
  }

  /** Diagnostic snapshot (exposed via window.__THERMAL_DEBUG in dev builds). */
  private debugState() {
    return {
      detectState: this.detectState,
      lastFaceSource: this.lastFaceSource,
      video: { w: this.video.videoWidth, h: this.video.videoHeight },
      detCanvas: { w: this.vidDetCanvas.width, h: this.vidDetCanvas.height },
      faces: this.faces.map((f) => ({
        x: +f.x.toFixed(3),
        y: +f.y.toFixed(3),
        w: +f.w.toFixed(3),
        h: +f.h.toFixed(3),
        temp: +this.rawToTemp(f.raw).toFixed(1),
      })),
      blobs: this.blobs.map((b) => ({
        x: +b.x.toFixed(3),
        y: +b.y.toFixed(3),
        w: +b.w.toFixed(3),
        h: +b.h.toFixed(3),
        temp: +this.rawToTemp(b.raw).toFixed(1),
      })),
    }
  }

  private maybeDetect() {
    const mode = this.params.detectMode
    if (mode === 'off') {
      if (this.faces.length > 0) this.faces = []
      if (this.blobs.length > 0) this.blobs = []
      return
    }
    if (mode === 'faces') {
      void this.ensureDetector()
      if (++this.detTick % 4 !== 0) return
      this.runFaceDetection()
    }
  }

  /** Lazily loads the bundled MediaPipe face detector (fully local — no CDN calls). */
  private async ensureDetector() {
    if (this.detector || this.detectState === 'loading' || this.detectState === 'failed') return
    this.detectState = 'loading'
    this.onDetectStatus?.('loading')
    const init = async (delegate: 'GPU' | 'CPU') => {
      const vision = await import('@mediapipe/tasks-vision')
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const { FaceDetector } = vision
      return (await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/models/blaze_face_short_range.tflite',
          delegate,
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.45,
      })) as unknown as MpFaceDetectorLike
    }
    try {
      this.detector = await init('GPU')
    } catch {
      try {
        this.detector = await init('CPU')
      } catch {
        this.detector = null
        this.detectState = 'failed'
        this.onDetectStatus?.('failed')
        return
      }
    }
    this.detErr = 0
    this.detectState = 'ready'
    this.onDetectStatus?.('ready')
  }

  /** Runs face detection on the raw color frame first (most reliable), then on the
   *  night-boosted luminance frame as a fallback for dark scenes. Boxes are mapped
   *  into display space (mirror + zoom aware) and temperature-sampled from the
   *  accumulated thermal buffer in analyze(). */
  private runFaceDetection() {
    const det = this.detector
    if (!det || this.video.readyState < 2) return
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (!vw || !vh) return

    // 1) primary pass: raw color camera frame
    const vc = this.vidDetCanvas
    const dw = 320
    const dh = Math.max(2, Math.round((dw / vw) * vh))
    if (vc.width !== dw || vc.height !== dh) {
      vc.width = dw
      vc.height = dh
    }
    const vctx = vc.getContext('2d')
    if (!vctx) return
    vctx.drawImage(this.video, 0, 0, dw, dh)
    let boxes = this.detectBoxes(vc)
    if (boxes.length > 0) {
      boxes = boxes
        .map((b) => this.videoBoxToDisplay(b, dw, dh))
        .filter((b): b is { x: number; y: number; w: number; h: number; raw: number } => b != null)
    }
    if (boxes.length > 0) this.lastFaceSource = 'video'

    // 2) fallback: night-boosted accumulated luminance (dark scenes)
    if (boxes.length === 0 && this.accumA && this.det && this.readDetLuminanceCanvas()) {
      boxes = this.detectBoxes(this.detCanvas)
      if (boxes.length > 0) this.lastFaceSource = 'luma'
    }
    if (boxes.length === 0) this.lastFaceSource = 'none'

    if (boxes.length === 0) {
      if (++this.faceMiss > 12) this.faces = []
      return
    }
    this.faceMiss = 0
    this.faces = this.matchTargets(this.faces, boxes.slice(0, 8))
  }

  /** Maps a box found on the raw video frame into display space (mirror + zoom inverse). */
  private videoBoxToDisplay(
    b: { x: number; y: number; w: number; h: number; raw: number },
    vw: number,
    vh: number,
  ): { x: number; y: number; w: number; h: number; raw: number } | null {
    const z = this.params.zoom
    const vx = b.x + b.w / 2
    const vyTop = b.y + b.h / 2
    const u = this.mirrorActive ? 1 - vx : vx
    const v = 1 - vyTop
    const cx = (u - 0.5) * z + 0.5
    const cyTop = 1 - ((v - 0.5) * z + 0.5)
    const bw = b.w * z
    const bh = b.h * z
    const x0 = cx - bw / 2
    const y0 = cyTop - bh / 2
    if (x0 > 1 || x0 + bw < 0 || y0 > 1 || y0 + bh < 0) return null
    const x = clamp(x0, 0, 1)
    const y = clamp(y0, 0, 1)
    const w = Math.min(bw - (x - x0), 1 - x)
    const h = Math.min(bh - (y - y0), 1 - y)
    if (w < 0.02 || h < 0.02) return null
    return { x, y, w, h, raw: 0 }
  }

  /** Detector wrapper — returns normalized boxes for the given canvas. */
  private detectBoxes(canvas: HTMLCanvasElement): Array<{ x: number; y: number; w: number; h: number; raw: number }> {
    const det = this.detector
    if (!det) return []
    try {
      this.detTs = Math.max(this.detTs + 10, performance.now())
      const res = det.detectForVideo(canvas, this.detTs)
      this.detErr = 0
      const out: Array<{ x: number; y: number; w: number; h: number; raw: number }> = []
      for (const d of res.detections ?? []) {
        const bb = d.boundingBox
        const score = d.categories?.[0]?.score ?? 0
        if (!bb || score < 0.45) continue
        const x = clamp(bb.originX / canvas.width, 0, 0.99)
        const y = clamp(bb.originY / canvas.height, 0, 0.99)
        const w = clamp(bb.width / canvas.width, 0.02, 1 - x)
        const h = clamp(bb.height / canvas.height, 0.02, 1 - y)
        out.push({ x, y, w, h, raw: 0 })
      }
      return out
    } catch {
      if (++this.detErr > 8) {
        this.detector = null
        this.detectState = 'failed'
        this.onDetectStatus?.('failed')
      }
      return []
    }
  }

  /** Renders the night-boosted luminance frame into detCanvas as normalized grayscale. */
  private readDetLuminanceCanvas(): boolean {
    const dt = this.det
    if (!dt || !this.accumA) return false
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, dt.fbo)
    gl.viewport(0, 0, dt.w, dt.h)
    gl.useProgram(this.progDown)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.accumA.tex)
    gl.uniform1i(this.uni(this.progDown, 'uTex'), 0)
    this.drawQuad(this.progDown)
    gl.readPixels(0, 0, dt.w, dt.h, gl.RGBA, gl.UNSIGNED_BYTE, this.detBuf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const dctx = this.detCanvas.getContext('2d', { willReadFrequently: true })
    if (!dctx) return false
    const img = dctx.createImageData(dt.w, dt.h)
    const out = img.data
    const n = dt.w * dt.h
    let minV = 255
    let maxV = 0
    for (let i = 0; i < n; i++) {
      const v = this.detBuf[i * 4]
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const span = Math.max(maxV - minV, 6)
    for (let y = 0; y < dt.h; y++) {
      const srcRow = (dt.h - 1 - y) * dt.w // readPixels rows are bottom-up
      for (let x = 0; x < dt.w; x++) {
        const s = (srcRow + x) * 4
        const v = Math.round(((this.detBuf[s] - minV) / span) * 255)
        const o = (y * dt.w + x) * 4
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
        out[o + 3] = 255
      }
    }
    dctx.putImageData(img, 0, 0)
    return true
  }

  /** Connected-component hot regions on the 96×54 analysis buffer (heat-source tracking). */
  private computeBlobs() {
    const t = this.tiny
    if (!t) return
    const w = t.w
    const h = t.h
    const n = w * h
    const buf = this.readBuf
    const span = Math.max(this.hotRaw - this.coldRaw, 10)
    const th = this.coldRaw + span * 0.62
    const visited = new Uint8Array(n)
    const found: Array<{ x: number; y: number; w: number; h: number; raw: number; score: number }> = []
    const stack: number[] = []

    for (let i = 0; i < n; i++) {
      if (visited[i] || buf[i * 4] < th) continue
      stack.length = 0
      stack.push(i)
      visited[i] = 1
      let minx = w
      let maxx = -1
      let miny = h
      let maxy = -1
      let area = 0
      let peak = 0
      while (stack.length) {
        const p = stack.pop() as number
        const px = p % w
        const py = (p / w) | 0
        area++
        const v = buf[p * 4]
        if (v > peak) peak = v
        if (px < minx) minx = px
        if (px > maxx) maxx = px
        if (py < miny) miny = py
        if (py > maxy) maxy = py
        if (px > 0 && !visited[p - 1] && buf[(p - 1) * 4] >= th) {
          visited[p - 1] = 1
          stack.push(p - 1)
        }
        if (px < w - 1 && !visited[p + 1] && buf[(p + 1) * 4] >= th) {
          visited[p + 1] = 1
          stack.push(p + 1)
        }
        if (py > 0 && !visited[p - w] && buf[(p - w) * 4] >= th) {
          visited[p - w] = 1
          stack.push(p - w)
        }
        if (py < h - 1 && !visited[p + w] && buf[(p + w) * 4] >= th) {
          visited[p + w] = 1
          stack.push(p + w)
        }
      }
      if (area < 10 || maxx < 0) continue
      // buffer rows are bottom-origin -> convert to display coords (y: 0 top)
      const xL = minx / w
      const ww = (maxx + 1 - minx) / w
      const yT = 1 - (maxy + 1) / h
      const hh = (maxy + 1 - miny) / h
      const padX = ww * 0.15 + 0.006
      const padY = hh * 0.15 + 0.006
      const x = clamp(xL - padX, 0, 0.99)
      const y = clamp(yT - padY, 0, 0.99)
      found.push({
        x,
        y,
        w: Math.min(ww + 2 * padX, 1 - x),
        h: Math.min(hh + 2 * padY, 1 - y),
        raw: peak / 255,
        score: (peak / 255) * Math.sqrt(area),
      })
    }

    found.sort((a, b) => b.score - a.score)
    const top = found.slice(0, 3)
    this.blobs = this.matchTargets(this.blobs, top)
    for (const b of this.blobs) this.sampleBoxMax(b)
  }

  /** Max raw luminance inside a target box, sampled from the 96×54 analysis buffer. */
  private sampleBoxMax(b: TargetBox) {
    const t = this.tiny
    if (!t) return
    const x0 = clamp(Math.floor(b.x * t.w - 1), 0, t.w - 1)
    const x1 = clamp(Math.ceil((b.x + b.w) * t.w + 1), 0, t.w - 1)
    const y0 = clamp(Math.floor((1 - (b.y + b.h)) * t.h - 1), 0, t.h - 1)
    const y1 = clamp(Math.ceil((1 - b.y) * t.h + 1), 0, t.h - 1)
    let mx = 0
    for (let y = y0; y <= y1; y++) {
      const row = y * t.w
      for (let x = x0; x <= x1; x++) {
        const v = this.readBuf[(row + x) * 4]
        if (v > mx) mx = v
      }
    }
    const raw = mx / 255
    b.raw += (raw - b.raw) * (b.raw <= 0 ? 1 : 0.25)
  }

  /** Greedy nearest-center matching with position/size smoothing for stable overlays. */
  private matchTargets(
    prev: TargetBox[],
    next: Array<{ x: number; y: number; w: number; h: number; raw: number }>,
  ): TargetBox[] {
    const used = new Set<number>()
    const out: TargetBox[] = []
    for (const nx of next) {
      let best = -1
      let bd = Infinity
      for (let i = 0; i < prev.length; i++) {
        if (used.has(i)) continue
        const p = prev[i]
        const d = Math.hypot(p.x + p.w / 2 - (nx.x + nx.w / 2), p.y + p.h / 2 - (nx.y + nx.h / 2))
        if (d < bd) {
          bd = d
          best = i
        }
      }
      let t: TargetBox
      if (best >= 0 && bd < 0.2) {
        used.add(best)
        const p = prev[best]
        t = {
          id: p.id,
          x: p.x + (nx.x - p.x) * 0.45,
          y: p.y + (nx.y - p.y) * 0.45,
          w: p.w + (nx.w - p.w) * 0.45,
          h: p.h + (nx.h - p.h) * 0.45,
          raw: p.raw,
        }
      } else {
        t = { ...nx, id: ++this.tgtId }
      }
      out.push(t)
    }
    return out
  }

  /** Inverse mapping: display temperature -> raw accumulated luminance. */
  private rawForTemp(t: number): number {
    const { calA, calB, minTemp, maxTemp } = this.params
    if (calA && calB) {
      const dl = calB.lum - calA.lum
      const dt = calB.temp - calA.temp
      if (Math.abs(dl) < 1e-4 || Math.abs(dt) < 1e-4) return calA.lum
      return clamp(calA.lum + ((t - calA.temp) / dt) * dl, 0, 1)
    }
    const v = clamp((t - minTemp) / Math.max(maxTemp - minTemp, 0.5), 0, 1)
    return this.lo + v * Math.max(this.hi - this.lo, 0.04)
  }

  /** Raw accumulated luminance -> display temperature (calibration-aware, emissivity-corrected). */
  private rawToTemp(raw: number): number {
    const { calA, calB, emissivity, minTemp, maxTemp } = this.params
    let t: number
    if (calA && calB) {
      const dl = calB.lum - calA.lum
      const dt = calB.temp - calA.temp
      t = Math.abs(dl) < 1e-4 ? calA.temp : calA.temp + ((raw - calA.lum) / dl) * dt
    } else {
      const v = clamp((raw - this.lo) / Math.max(this.hi - this.lo, 0.04), 0, 1)
      t = minTemp + v * (maxTemp - minTemp)
    }
    // Stefan-Boltzmann apparent->true correction: T_true = T_app / e^(1/4)
    // Clamped to a plausible instrument range so extrapolated luminance can't produce absurd numbers
    const e = clamp(emissivity, 0.1, 1)
    return clamp(t / Math.pow(e, 0.25), -60, 400)
  }

  private fmtTemp(tC: number): string {
    if (this.params.unit === 'F') return `${((tC * 9) / 5 + 32).toFixed(1)}°F`
    return `${tC.toFixed(1)}°C`
  }

  /** Temperature difference (no offset in either unit). */
  private fmtDelta(dC: number): string {
    const d = Math.abs(dC)
    if (this.params.unit === 'F') return `${((d * 9) / 5).toFixed(1)} °F`
    return `${d.toFixed(1)} K`
  }

  private emitStats() {
    const hotTemp = this.rawToTemp(this.hotRaw / 255)
    const nowAlarm = this.params.alarmEnabled && hotTemp >= this.params.alarmTemp
    if (nowAlarm && !this.alarmActive) this.onAlarm?.(hotTemp)
    this.alarmActive = nowAlarm
    const targets =
      this.params.detectMode === 'off'
        ? 0
        : this.params.detectMode === 'faces' && this.faces.length > 0
          ? this.faces.length
          : this.blobs.length
    this.onStats?.({
      fps: this.fps,
      width: this.accumA?.w ?? 0,
      height: this.accumA?.h ?? 0,
      centerTemp: this.rawToTemp(this.spotRawSm),
      hotTemp,
      coldTemp: this.rawToTemp(this.coldRaw / 255),
      avgTemp: this.rawToTemp(this.avgRaw),
      targets,
      alarm: nowAlarm,
    })
  }

  /* ------------------------------ HUD ------------------------------ */

  private drawHud() {
    const ctx = this.hudCtx
    const w = this.hudW
    const h = this.hudH
    if (w < 2 || h < 2) return
    ctx.clearRect(0, 0, w, h)
    const p = this.params
    const lut = this.lutColors

    if (p.statsPanel) this.drawStatsPanel(ctx)
    this.drawTelemetry(ctx, w, h)
    if (p.scaleBar) this.drawScaleBar(ctx, w, h)
    if (p.markers && lut) {
      this.drawMarker(ctx, w, h, this.hotPtSm, true, lut)
      this.drawMarker(ctx, w, h, this.coldPtSm, false, lut)
    }
    if (p.crosshair) this.drawCrosshair(ctx, w, h)
    this.drawTargets(ctx, w, h)
    this.drawSpots(ctx, w, h)
    if (p.paletteId === 'nightvision') this.drawNvOverlay(ctx, w, h)
    if (this.isAlarmHot()) this.drawAlarmBanner(ctx, w, h)
    this.drawStamp(ctx, w, h)
  }

  /* ------------------------- measurement HUD layers ------------------------- */

  /** Fluke-style MAX/MIN/AVG/ΔT measurement panel (top-left). */
  private drawStatsPanel(ctx: CanvasRenderingContext2D) {
    const px = 12
    const py = 12
    const pw = 132
    const rowH = 16
    const maxT = this.rawToTemp(this.hotRaw / 255)
    const minT = this.rawToTemp(this.coldRaw / 255)
    const rows: Array<[string, string, string]> = [
      ['MAX', this.fmtTemp(maxT), '#ffb020'],
      ['MIN', this.fmtTemp(minT), 'rgba(255,255,255,0.92)'],
      ['AVG', this.fmtTemp(this.rawToTemp(this.avgRaw)), 'rgba(255,255,255,0.72)'],
      ['ΔT', this.fmtDelta(maxT - minT), 'rgba(255,255,255,0.72)'],
    ]
    const ph = 30 + rows.length * rowH + 4
    ctx.fillStyle = 'rgba(0,0,0,0.52)'
    roundRectPath(ctx, px, py, pw, ph, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1
    roundRectPath(ctx, px, py, pw, ph, 8)
    ctx.stroke()
    ctx.font = MONO_FONT_SM
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'left'
    ctx.fillText('M E A S U R E', px + 12, py + 17)
    ctx.font = MONO_FONT
    let y = py + 36
    for (const [label, value, color] of rows) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillText(label, px + 12, y)
      ctx.fillStyle = color
      ctx.textAlign = 'right'
      ctx.fillText(value, px + pw - 12, y)
      ctx.textAlign = 'left'
      y += rowH
    }
  }

  /** Sensor telemetry line, like the info strip on a real thermal camera. */
  private drawTelemetry(ctx: CanvasRenderingContext2D, w: number, h: number) {
    void h
    const p = this.params
    const vw = this.accumA?.w ?? 0
    const vh = this.accumA?.h ?? 0
    const pal = getPalette(p.paletteId).name.toUpperCase()
    const line = `IR ${vw}×${vh}  ${this.fps} FPS  ${pal}  ${p.zoom}× ZOOM  EST °${p.unit}`
    ctx.font = MONO_FONT_SM
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 3
    ctx.textAlign = 'left'
    ctx.fillText(line, 14, p.statsPanel ? 132 : 22)
    ctx.shadowBlur = 0
  }

  /** AI target boxes with per-target temperature chips. */
  private drawTargets(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const mode = this.params.detectMode
    if (mode === 'off') return
    let list: TargetBox[] = this.blobs
    let prefix = 'H'
    if (mode === 'faces' && this.faces.length > 0) {
      list = this.faces
      prefix = 'P'
    } else if (mode === 'faces') {
      prefix = 'T'
    }
    const ranked = [...list].sort((a, b) => b.raw - a.raw)
    for (let i = 0; i < ranked.length; i++) {
      const t = ranked[i]
      const temp = this.rawToTemp(t.raw)
      const alarm = this.params.alarmEnabled && temp >= this.params.alarmTemp
      this.drawTargetBox(ctx, w, h, t, `${prefix}${i + 1}`, temp, alarm)
    }
  }

  private drawTargetBox(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: TargetBox,
    tag: string,
    temp: number,
    alarm: boolean,
  ) {
    const x = clamp(t.x, 0, 0.99) * w
    const y = clamp(t.y, 0, 0.99) * h
    const bw = Math.max(t.w * w, 16)
    const bh = Math.max(t.h * h, 16)
    const color = alarm ? 'rgba(255,70,70,0.95)' : 'rgba(255,255,255,0.9)'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 3
    ctx.strokeRect(x, y, bw, bh)
    // corner accents
    ctx.lineWidth = 2.5
    const cl = Math.min(bw, bh) * 0.22
    ctx.beginPath()
    ctx.moveTo(x, y + cl)
    ctx.lineTo(x, y)
    ctx.lineTo(x + cl, y)
    ctx.moveTo(x + bw - cl, y)
    ctx.lineTo(x + bw, y)
    ctx.lineTo(x + bw, y + cl)
    ctx.moveTo(x + bw, y + bh - cl)
    ctx.lineTo(x + bw, y + bh)
    ctx.lineTo(x + bw - cl, y + bh)
    ctx.moveTo(x + cl, y + bh)
    ctx.lineTo(x, y + bh)
    ctx.lineTo(x, y + bh - cl)
    ctx.stroke()

    // target tag chip (top-left, inside)
    ctx.font = MONO_FONT_SM
    ctx.textAlign = 'left'
    ctx.fillStyle = alarm ? 'rgba(215,22,30,0.92)' : 'rgba(0,0,0,0.6)'
    roundRectPath(ctx, x + 2, y + 2, 22, 14, 3)
    ctx.fill()
    ctx.fillStyle = alarm ? '#ffffff' : 'rgba(255,255,255,0.85)'
    ctx.fillText(tag, x + 6, y + 13)

    // temperature chip (bottom-left, inside)
    ctx.font = MONO_FONT_B
    const tw = ctx.measureText(this.fmtTemp(temp)).width
    const chH = 18
    const chY = Math.max(y + 18, y + bh - chH - 2)
    ctx.fillStyle = alarm ? 'rgba(215,22,30,0.92)' : 'rgba(0,0,0,0.62)'
    roundRectPath(ctx, x + 2, chY, tw + 12, chH, 3)
    ctx.fill()
    ctx.fillStyle = alarm ? '#ffe0e0' : '#ffffff'
    ctx.fillText(this.fmtTemp(temp), x + 8, chY + 13)
    ctx.shadowBlur = 0
  }

  /** Blinking top alarm banner + red edge vignette when the scene exceeds the alarm threshold. */
  private drawAlarmBanner(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 110)
    const temp = this.fmtTemp(this.rawToTemp(this.hotRaw / 255))
    const bw = Math.min(300, w - 24)
    const bh = 32
    const x = (w - bw) / 2
    const y = 12
    ctx.fillStyle = `rgba(196,18,26,${0.72 + 0.2 * blink})`
    roundRectPath(ctx, x, y, bw, bh, 7)
    ctx.fill()
    ctx.strokeStyle = `rgba(255,110,110,${0.6 + 0.35 * blink})`
    ctx.lineWidth = 1.5
    roundRectPath(ctx, x, y, bw, bh, 7)
    ctx.stroke()
    ctx.font = MONO_FONT_B
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 3
    ctx.fillText(`TEMP ALARM  ${temp}`, w / 2, y + 20)
    ctx.fillStyle = `rgba(255,32,40,${0.1 + 0.1 * blink})`
    ctx.fillRect(0, 0, w, 5)
    ctx.fillRect(0, h - 5, w, 5)
    ctx.fillRect(0, 0, 5, h)
    ctx.fillRect(w - 5, 0, 5, h)
    ctx.shadowBlur = 0
    ctx.textAlign = 'left'
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const lut = this.lutColors
    if (!lut) return
    const barW = 12
    const barH = Math.min(h * 0.55, 340)
    const x = w - 40
    const y0 = (h - barH) / 2

    // backdrop panel
    ctx.fillStyle = 'rgba(0,0,0,0.42)'
    roundRectPath(ctx, x - 54, y0 - 18, 66, barH + 36, 8)
    ctx.fill()

    const grad = ctx.createLinearGradient(0, y0 + barH, 0, y0)
    for (let i = 0; i <= 10; i++) {
      const idx = Math.round((i / 10) * 255) * 4
      grad.addColorStop(i / 10, `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`)
    }
    ctx.fillStyle = grad
    roundRectPath(ctx, x, y0, barW, barH, 4)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    roundRectPath(ctx, x, y0, barW, barH, 4)
    ctx.stroke()

    ctx.font = MONO_FONT_SM
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.textAlign = 'right'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 3
    const span = Math.max(this.hi - this.lo, 0.04)
    for (let i = 0; i <= 4; i++) {
      const f = 1 - i / 4 // 1 = hot top, 0 = cold bottom
      const ty = y0 + (i / 4) * barH
      ctx.fillRect(x - 7, ty - 0.5, 5, 1)
      const t = this.fmtTemp(this.rawToTemp(this.lo + f * span))
      ctx.fillText(t, x - 10, ty + 3)
    }
    ctx.fillText(this.params.unit === 'F' ? '°F' : '°C', x - 10, y0 - 6)
    ctx.shadowBlur = 0
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2
    const cy = h / 2
    const s = 9
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 3
    // bracket corners
    ctx.beginPath()
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.moveTo(cx + dx * s, cy + dy * s - dy * 4)
      ctx.lineTo(cx + dx * s, cy + dy * s)
      ctx.lineTo(cx + dx * s - dx * 4, cy + dy * s)
    }
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.arc(cx, cy, 1.6, 0, Math.PI * 2)
    ctx.fill()

    // pulsing ring during calibration
    if (this.calibrating) {
      const r = 18 + 6 * Math.sin(performance.now() / 140)
      ctx.strokeStyle = '#ffb020'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // spot temperature label
    const label = this.fmtTemp(this.rawToTemp(this.spotRawSm))
    ctx.font = MONO_FONT
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    roundRectPath(ctx, cx - tw / 2 - 5, cy + s + 6, tw + 10, 16, 4)
    ctx.fill()
    ctx.fillStyle = '#ffb020'
    ctx.textAlign = 'center'
    ctx.fillText(label, cx, cy + s + 18)
    ctx.shadowBlur = 0
  }

  private drawMarker(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    pt: { x: number; y: number },
    hot: boolean,
    lut: Uint8Array,
  ) {
    const x = clamp(pt.x, 0.04, 0.96) * w
    const y = (1 - clamp(pt.y, 0.04, 0.96)) * h
    const s = 13
    const ci = hot ? 248 * 4 : 6 * 4
    // Dark palette ends (e.g. ironbow cold) are invisible on dark scenes — lift toward white
    let mr = lut[ci]
    let mg = lut[ci + 1]
    let mb = lut[ci + 2]
    const lum = 0.2126 * mr + 0.7152 * mg + 0.0722 * mb
    if (lum < 80) {
      const f = 0.7
      mr = Math.round(mr + (255 - mr) * f)
      mg = Math.round(mg + (255 - mg) * f)
      mb = Math.round(mb + (255 - mb) * f)
    }
    const color = `rgb(${mr},${mg},${mb})`

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 3
    ctx.beginPath()
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.moveTo(x + dx * s, y + dy * s - dy * 5)
      ctx.lineTo(x + dx * s, y + dy * s)
      ctx.lineTo(x + dx * s - dx * 5, y + dy * s)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    const raw = hot ? this.hotRaw / 255 : this.coldRaw / 255
    const label = `${hot ? 'HOT' : 'COLD'} ${this.fmtTemp(this.rawToTemp(raw))}`
    ctx.font = MONO_FONT
    const tw = ctx.measureText(label).width
    const ly = hot ? y - s - 20 : y + s + 6
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    roundRectPath(ctx, x - tw / 2 - 5, ly, tw + 10, 16, 4)
    ctx.fill()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(label, x, ly + 12)
  }

  /* ------------------------- advanced HUD layers ------------------------- */

  private drawSpots(ctx: CanvasRenderingContext2D, w: number, h: number) {
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i]
      const x = s.x * w
      const y = s.y * h
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.lineWidth = 1.5
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 3
      ctx.beginPath()
      ctx.moveTo(x - 8, y)
      ctx.lineTo(x - 3, y)
      ctx.moveTo(x + 3, y)
      ctx.lineTo(x + 8, y)
      ctx.moveTo(x, y - 8)
      ctx.lineTo(x, y - 3)
      ctx.moveTo(x, y + 3)
      ctx.lineTo(x, y + 8)
      ctx.stroke()
      ctx.shadowBlur = 0

      const label = `${i + 1} ${this.fmtTemp(this.rawToTemp(s.raw))}`
      ctx.font = MONO_FONT
      const tw = ctx.measureText(label).width
      const ly = y + 9
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      roundRectPath(ctx, x - tw / 2 - 5, ly, tw + 10, 16, 4)
      ctx.fill()
      ctx.fillStyle = '#ffb020'
      ctx.textAlign = 'center'
      ctx.fillText(label, x, ly + 12)
    }
  }

  private drawNvOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  private drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    ctx.font = MONO_FONT_SM
    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 3
    ctx.textAlign = 'left'
    ctx.fillText(`${s}  THERMALVISION`, 12, h - 12)
    ctx.shadowBlur = 0
  }

  /* --------------------------- spots & calibration --------------------------- */

  private onGlClick(e: MouseEvent) {
    if (!this.stream) return
    const rect = this.glCanvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1)
    if (this.spots.length >= 3) this.spots.shift()
    this.spots.push({ x, y, raw: this.spotRawSm })
    this.onSpots?.(this.spots.length)
  }

  clearSpots() {
    this.spots = []
    this.onSpots?.(0)
  }

  /** Raw luminance currently measured by the center crosshair (for 2-point calibration). */
  getSpotLuminance(): number {
    return this.spotRawSm
  }

  setCalibrating(v: boolean) {
    this.calibrating = v
  }

  /* ------------------------------ capture ------------------------------ */

  capturePhoto(): void {
    const c = document.createElement('canvas')
    c.width = this.glCanvas.width
    c.height = this.glCanvas.height
    const x = c.getContext('2d')
    if (!x) return
    x.drawImage(this.glCanvas, 0, 0)
    x.drawImage(this.hudCanvas, 0, 0, c.width, c.height)
    c.toBlob((blob) => {
      if (!blob) return
      this.download(blob, `thermal-photo-${this.stamp()}.png`)
    }, 'image/png')
    this.onCapture?.()
  }

  get recording(): boolean {
    return !!this.recorder && this.recorder.state === 'recording'
  }

  startRecording(): void {
    if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser')
    if (this.recorder) return

    const c = document.createElement('canvas')
    c.width = this.glCanvas.width
    c.height = this.glCanvas.height
    this.recCanvas = c
    this.recCtx = c.getContext('2d')

    const stream = c.captureStream(30)
    const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m))
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined)
    this.recChunks = []
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recChunks.push(e.data)
    }
    this.recorder.onstop = () => {
      const rec = this.recorder
      const type = rec?.mimeType || 'video/webm'
      const ext = type.includes('mp4') ? 'mp4' : 'webm'
      const blob = new Blob(this.recChunks, { type })
      rec?.stream.getTracks().forEach((t) => t.stop())
      this.recorder = null
      this.recChunks = []
      this.recCanvas = null
      this.recCtx = null
      if (this.disposing) return
      this.download(blob, `thermal-video-${this.stamp()}.${ext}`)
      this.onRecordStop?.()
    }
    this.recorder.start(250)
  }

  stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
  }

  private stamp(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }

  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  /* ------------------------------ teardown ------------------------------ */

  dispose() {
    this.disposing = true
    this.running = false
    cancelAnimationFrame(this.raf)
    this.stopStream()
    this.video.srcObject = null
    const rec = this.recorder
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    rec?.stream.getTracks().forEach((t) => t.stop())
    this.recorder = null
    this.recCanvas = null
    this.recCtx = null
    this.detector?.close?.()
    this.detector = null
    this.glCanvas.removeEventListener('click', this.onGlClick)
    this.resizeObs?.disconnect()
    this.resizeObs = null
    this.destroyTarget(this.accumA)
    this.destroyTarget(this.accumB)
    this.destroyTarget(this.memA)
    this.destroyTarget(this.memB)
    this.destroyTarget(this.tiny)
    this.destroyTarget(this.det)
    this.accumA = this.accumB = this.memA = this.memB = this.tiny = this.det = null
    const gl = this.gl
    gl.deleteProgram(this.progIntegrate)
    gl.deleteProgram(this.progInertia)
    gl.deleteProgram(this.progGrade)
    gl.deleteProgram(this.progDown)
    gl.deleteBuffer(this.quadBuf)
    gl.deleteTexture(this.videoTex)
    gl.deleteTexture(this.lutTex)
    this.locs.clear()
    this.aPos.clear()
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__THERMAL_DEBUG
    }
  }
}
