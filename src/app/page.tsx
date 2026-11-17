'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Flame, MoonStar, ScanFace, ShieldCheck, TriangleAlert, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThermalControls } from '@/components/thermal/controls'
import {
  DEFAULT_PARAMS,
  ThermalEngine,
  type DetectState,
  type NightLevel,
  type ThermalParams,
  type ThermalStats,
} from '@/lib/thermal/engine'
import { useToast } from '@/hooks/use-toast'

const NIGHT_PRESETS: Record<NightLevel, Partial<ThermalParams>> = {
  off: { gain: 1, integration: 0, motionBoost: 0.4 },
  auto: { gain: 1, integration: 0.35, motionBoost: 0.6 },
  night: { gain: 2.5, integration: 0.65, motionBoost: 0.5 },
  deep: { gain: 5, integration: 0.92, motionBoost: 0.35 },
}

const NIGHT_KEYS = ['gain', 'integration', 'motionBoost'] as const

/** Preset matching the current params, or null when the sliders were moved off-preset. */
function nightLevelFor(params: ThermalParams): NightLevel | null {
  return (
    (Object.keys(NIGHT_PRESETS) as NightLevel[]).find((level) =>
      NIGHT_KEYS.every((k) => Math.abs(params[k] - (NIGHT_PRESETS[level][k] ?? NaN)) < 0.001)
    ) ?? null
  )
}

const NIGHT_NAMES: Record<NightLevel, string> = {
  off: 'Boost OFF',
  auto: 'Auto',
  night: 'Night',
  deep: 'Deep Night',
}

function fmtRec(s: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`
}

export default function Home() {
  const viewportBoxRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<ThermalEngine | null>(null)

  const { toast } = useToast()
  const [params, setParams] = useState<ThermalParams>({ ...DEFAULT_PARAMS })
  const [stats, setStats] = useState<ThermalStats | null>(null)
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const [flash, setFlash] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [multiCam, setMultiCam] = useState(false)
  const [spotCount, setSpotCount] = useState(0)
  const [detectState, setDetectState] = useState<DetectState>('off')
  const [calDialog, setCalDialog] = useState<null | { step: 1 | 2; temp: string }>(null)

  /* engine lifecycle */
  useEffect(() => {
    if (!glRef.current || !hudRef.current || !viewportBoxRef.current) return
    let engine: ThermalEngine | null = null
    try {
      engine = new ThermalEngine(glRef.current, hudRef.current, viewportBoxRef.current)
      engineRef.current = engine
      engine.onStats = (s) => setStats(s)
      engine.onCapture = () => {
        setFlash(true)
        setTimeout(() => setFlash(false), 320)
        toast({ title: 'Photo saved', description: 'Thermal snapshot downloaded.' })
      }
      engine.onRecordStop = () => {
        setRecording(false)
        setRecSecs(0)
        toast({ title: 'Recording saved', description: 'Thermal video downloaded.' })
      }
      engine.onSpots = (n) => setSpotCount(n)
      engine.onDetectStatus = (state) => setDetectState(state)
      engine.onAlarm = (temp) => {
        toast({
          title: 'High temperature detected',
          description: `Hottest target ${temp.toFixed(1)}°C exceeds the alarm threshold.`,
          variant: 'destructive',
        })
      }
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : 'Failed to initialise WebGL')
    }
    return () => {
      engine?.dispose()
      engineRef.current = null
    }
  }, [])

  /* keep engine params in sync */
  useEffect(() => {
    engineRef.current?.setParams(params)
  }, [params])

  /* fullscreen state */
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /* recording timer */
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setRecSecs((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  const handleStart = useCallback(async () => {
    const engine = engineRef.current
    if (!engine || starting) return
    setStarting(true)
    setError(null)
    try {
      await engine.start(engine.facing)
      engine.setParams(params)
      setStarted(true)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setMultiCam(devices.filter((d) => d.kind === 'videoinput').length > 1)
      } catch {
        /* labels unavailable — keep Flip disabled */
      }
    } catch (e) {
      const err = e as Error
      const msg =
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in your browser and try again.'
          : err.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : err.name === 'NotReadableError'
              ? 'The camera is already in use by another application. Close it and retry.'
              : err.message || 'Failed to start the camera.'
      setError(msg)
    } finally {
      setStarting(false)
    }
  }, [params, starting])

  const handleNightLevel = useCallback((level: NightLevel) => {
    setParams((p) => ({ ...p, ...NIGHT_PRESETS[level] }))
  }, [])

  const patchParams = useCallback((patch: Partial<ThermalParams>) => {
    setParams((p) => ({ ...p, ...patch }))
  }, [])

  const handlePhoto = useCallback(() => {
    engineRef.current?.capturePhoto()
  }, [])

  const handleRecord = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (recording) {
      // stopRecording() throws if the recorder is already inactive (double click)
      if (engine.recording) engine.stopRecording()
      return
    }
    try {
      engine.startRecording()
      setRecording(true)
      setRecSecs(0)
    } catch (e) {
      toast({ title: 'Recording failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    }
  }, [recording, toast])

  const handleFlip = useCallback(() => {
    engineRef.current?.flipCamera().catch((e: Error) => {
      // start() stops the old stream first, so a failed flip leaves no picture
      setStarted(false)
      setError(e.message || 'Camera flip failed. Re-enable the camera to continue.')
      toast({ title: 'Flip failed', description: e.message, variant: 'destructive' })
    })
  }, [toast])

  const handleFullscreen = useCallback(() => {
    const el = fullscreenRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen().catch(() => {
        toast({ title: 'Fullscreen unavailable', description: 'Your browser blocked fullscreen mode.' })
      })
    }
  }, [toast])

  const handleClearSpots = useCallback(() => {
    engineRef.current?.clearSpots()
  }, [])

  const openCalibration = useCallback(() => {
    engineRef.current?.setCalibrating(true)
    setCalDialog({ step: 1, temp: '0' })
  }, [])

  const cancelCalibration = useCallback(() => {
    engineRef.current?.setCalibrating(false)
    setCalDialog(null)
  }, [])

  const captureCalPoint = useCallback(() => {
    const engine = engineRef.current
    if (!engine || !calDialog) return
    const temp = parseFloat(calDialog.temp)
    if (Number.isNaN(temp)) {
      toast({ title: 'Invalid temperature', description: 'Enter a number for the reference temperature.', variant: 'destructive' })
      return
    }
    const lum = engine.getSpotLuminance()
    if (calDialog.step === 1) {
      setParams((p) => ({ ...p, calA: { lum, temp } }))
      setCalDialog({ step: 2, temp: '33' })
    } else {
      setParams((p) => ({ ...p, calB: { lum, temp } }))
      setCalDialog(null)
      engine.setCalibrating(false)
      toast({
        title: '2-point calibration complete',
        description: 'All temperature readings are now anchored to your references.',
      })
    }
  }, [calDialog, toast])

  const nightLevel = nightLevelFor(params)

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/40">
            <Flame className="h-5 w-5 text-amber-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide sm:text-base">
              Thermal<span className="text-amber-400">Vision</span>
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Live LWIR-style imaging · webcam
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {started && (
            <span
              data-testid="night-badge"
              className="hidden items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-300 sm:flex"
            >
              <MoonStar className="h-3.5 w-3.5 text-amber-400" aria-hidden />
              {nightLevel ? NIGHT_NAMES[nightLevel] : 'Custom'}
            </span>
          )}
          {started && params.detectMode !== 'off' && (stats?.targets ?? 0) > 0 && (
            <span
              data-testid="target-badge"
              className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300"
            >
              <ScanFace className="h-3.5 w-3.5" aria-hidden />
              {stats?.targets} {stats?.targets === 1 ? 'TARGET' : 'TARGETS'}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px]">
            {started ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="text-red-400">LIVE</span>
              </>
            ) : (
              <span className="text-zinc-500">STANDBY</span>
            )}
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col items-center gap-4 px-3 py-4 sm:px-6 sm:py-6">
        <div
          ref={fullscreenRef}
          className={`flex w-full flex-1 items-center justify-center ${
            fullscreen ? 'bg-black' : ''
          }`}
        >
          {/* Viewport box */}
          <div
            ref={viewportBoxRef}
            className={`relative overflow-hidden bg-black ${
              fullscreen
                ? 'h-full w-auto max-w-none rounded-none border-0'
                : 'aspect-video w-full max-w-5xl rounded-xl border border-zinc-800 shadow-[0_0_40px_rgba(245,158,11,0.06)]'
            }`}
          >
            {/* WebGL thermal canvas */}
            <canvas
              ref={glRef}
              width={1280}
              height={720}
              aria-label="Thermal vision camera view"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            />
            {/* HUD overlay */}
            <canvas
              ref={hudRef}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            />

            {/* REC indicator */}
            {recording && (
              <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded bg-black/60 px-2.5 py-1 font-mono text-xs text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                REC {fmtRec(recSecs)}
              </div>
            )}

            {/* Flash on capture */}
            <div
              aria-hidden
              className={`absolute inset-0 bg-white transition-opacity duration-150 ${
                flash ? 'opacity-70' : 'pointer-events-none opacity-0'
              }`}
            />

            {/* Start / error overlay */}
            {!started && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black/85 px-6 text-center backdrop-blur-sm">
                {error ? (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/40">
                      <TriangleAlert className="h-7 w-7 text-red-400" aria-hidden />
                    </div>
                    <div className="max-w-sm">
                      <h2 className="text-lg font-semibold text-zinc-100">Camera unavailable</h2>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{error}</p>
                    </div>
                    <Button
                      onClick={handleStart}
                      disabled={starting}
                      className="h-11 bg-amber-500 px-6 font-semibold text-black hover:bg-amber-400"
                    >
                      {starting ? 'Starting…' : 'Retry'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
                      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/50">
                        <Flame className="h-8 w-8 text-amber-400" aria-hidden />
                      </div>
                    </div>
                    <div className="max-w-md">
                      <h2 className="text-xl font-bold">Thermal Vision Camera</h2>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                        Turns your laptop camera into a professional-style thermal imager: 10 FLIR
                        palettes, a Fluke-style MAX/MIN/AVG measure panel, on-device{' '}
                        <span className="text-amber-400">AI face &amp; heat-source screening</span>{' '}
                        with live temperature boxes, and a <span className="text-amber-400">Night
                        Boost</span> engine that stacks 25+ frames per shot so you can see in
                        near-total darkness.
                      </p>
                    </div>
                    <Button
                      onClick={handleStart}
                      disabled={starting}
                      size="lg"
                      className="h-12 bg-amber-500 px-8 text-base font-bold text-black hover:bg-amber-400"
                    >
                      <Video className="mr-2 h-5 w-5" aria-hidden />
                      {starting ? 'Starting camera…' : 'Enable Camera'}
                    </Button>
                    <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-zinc-600" aria-hidden />
                      100% local processing — video never leaves your device
                    </p>
                  </>
                )}
              </div>
            )}

            {/* WebGL failure overlay */}
            {engineError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
                <TriangleAlert className="h-8 w-8 text-red-400" aria-hidden />
                <p className="max-w-sm text-sm text-zinc-300">{engineError}</p>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="w-full max-w-5xl">
          <ThermalControls
            params={params}
            onChange={patchParams}
            started={started}
            nightLevel={nightLevel}
            onNightLevel={handleNightLevel}
            onPhoto={handlePhoto}
            onRecord={handleRecord}
            recording={recording}
            onFlip={handleFlip}
            onFullscreen={handleFullscreen}
            multiCam={multiCam}
            onCalibrate={openCalibration}
            onClearSpots={handleClearSpots}
            spotCount={spotCount}
            detectState={detectState}
          />
        </div>
      </main>

      {/* 2-point calibration dialog */}
      <Dialog open={calDialog !== null} onOpenChange={(open) => !open && cancelCalibration()}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="font-mono">
              2-Point Calibration — Step {calDialog?.step ?? 1} of 2
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-400">
              {calDialog?.step === 1
                ? 'Aim the center crosshair ( pulsing ring ) at a COLD reference surface — for example ice water (0°C) or the inside of a fridge. Then enter that temperature below.'
                : 'Now aim the center crosshair at a HOT reference — your palm (≈33°C), warm water, or a lamp bulb. Enter its temperature to anchor the top of the scale.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-1">
            <Label htmlFor="cal-temp" className="font-mono text-xs text-zinc-400">
              Reference °C
            </Label>
            <Input
              id="cal-temp"
              type="number"
              min={-50}
              max={150}
              step={0.5}
              value={calDialog?.temp ?? '0'}
              onChange={(e) =>
                setCalDialog((d) => (d ? { ...d, temp: e.target.value } : d))
              }
              className="h-9 w-28 border-zinc-800 bg-zinc-900 font-mono"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelCalibration} className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
              Cancel
            </Button>
            <Button onClick={captureCalPoint} className="bg-amber-500 font-semibold text-black hover:bg-amber-400">
              {calDialog?.step === 1 ? 'Capture cold point' : 'Capture hot point'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="mt-auto border-t border-zinc-900 px-4 py-3 text-center sm:px-6">
        <p className="mx-auto max-w-3xl text-[11px] leading-relaxed text-zinc-600">
          Simulated thermal imaging: your webcam estimates apparent heat from visible-light
          luminance — true long-wave-infrared sensing needs dedicated hardware, and no camera (not
          even military thermal) can see through walls, because solids block infrared and only
          radar / X-ray can pass through them. Night Boost integrates multiple frames to amplify
          the faintest light in darkness; in absolute 0-lux blackness no optical sensor can see.
          Face screening runs on a fully local AI model — temperature readouts are estimates.
          Use 2-point calibration with known references for the most accurate readings.
          All processing runs locally in your browser, nothing is uploaded.
        </p>
      </footer>
    </div>
  )
}
