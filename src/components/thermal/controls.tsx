'use client'

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import type { DetectMode, DetectState, NightLevel, ThermalParams } from '@/lib/thermal/engine'
import { PALETTES, paletteGradientCss } from '@/lib/thermal/palettes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Camera,
  Eraser,
  Flame,
  Maximize2,
  Moon,
  MoonStar,
  CircleStop,
  ScanFace,
  Sparkles,
  Sun,
  SwitchCamera,
  Video,
  ZoomIn,
} from 'lucide-react'

interface ControlsProps {
  params: ThermalParams
  onChange: (patch: Partial<ThermalParams>) => void
  started: boolean
  nightLevel: NightLevel | null
  onNightLevel: (level: NightLevel) => void
  onPhoto: () => void
  onRecord: () => void
  recording: boolean
  onFlip: () => void
  onFullscreen: () => void
  multiCam: boolean
  onCalibrate: () => void
  onClearSpots: () => void
  spotCount: number
  detectState: DetectState
}

const NIGHT_LEVELS: Array<{ id: NightLevel; name: string; icon: ReactNode; hint: string }> = [
  { id: 'off', name: 'Off', icon: <Sun className="h-3.5 w-3.5" />, hint: 'Standard mode — no frame stacking. Best for lit scenes.' },
  { id: 'auto', name: 'Auto', icon: <Sparkles className="h-3.5 w-3.5" />, hint: 'Light frame integration — balanced for indoor / dusk scenes.' },
  { id: 'night', name: 'Night', icon: <Moon className="h-3.5 w-3.5" />, hint: 'Strong integration + gain boost. Sees in dim rooms and near-darkness.' },
  { id: 'deep', name: 'Deep Night', icon: <MoonStar className="h-3.5 w-3.5" />, hint: 'Maximum integration (≈9 frames averaged). For pitch-dark rooms — moving objects may leave short trails.' },
]

const DETECT_MODES: Array<{ id: DetectMode; name: string; icon: ReactNode; hint: string }> = [
  { id: 'off', name: 'Off', icon: <CircleStop className="h-3.5 w-3.5" />, hint: 'No target boxes — clean scene view.' },
  { id: 'hot', name: 'Heat spots', icon: <Flame className="h-3.5 w-3.5" />, hint: 'Tracks the 3 hottest regions (people, animals, engines, lamps) with live temperature boxes — like wildlife / surveillance thermal cams.' },
  { id: 'faces', name: 'Face screening', icon: <ScanFace className="h-3.5 w-3.5" />, hint: 'On-device AI finds faces and boxes them with live temperature readouts (P1, P2…) — fever-screening style. Falls back to heat tracking in total darkness.' },
]

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
      {children}
    </div>
  )
}

/** Number input that can be cleared while typing and clamps to [min, max] on blur. */
function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
  ...props
}: {
  value: number
  min: number
  max: number
  step: number
  onCommit: (v: number) => void
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'>) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => {
        const s = e.target.value
        setDraft(s)
        const v = parseFloat(s)
        if (!Number.isNaN(v) && v >= min && v <= max) onCommit(v)
      }}
      onBlur={() => {
        const v = parseFloat(draft)
        if (Number.isNaN(v)) {
          setDraft(String(value))
          return
        }
        const clamped = Math.min(max, Math.max(min, v))
        setDraft(String(clamped))
        onCommit(clamped)
      }}
    />
  )
}

export function ThermalControls({
  params,
  onChange,
  started,
  nightLevel,
  onNightLevel,
  onPhoto,
  onRecord,
  recording,
  onFlip,
  onFullscreen,
  multiCam,
  onCalibrate,
  onClearSpots,
  spotCount,
  detectState,
}: ControlsProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
        {/* Palettes */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Thermal palette</SectionLabel>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {PALETTES.map((p) => {
              const active = params.paletteId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ paletteId: p.id })}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                    active
                      ? 'border-amber-400/80 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded border border-zinc-700"
                    style={{ background: paletteGradientCss(p) }}
                    aria-hidden
                  />
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Night boost */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SectionLabel>Night boost</SectionLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-help font-mono text-[10px] text-zinc-500 underline decoration-dotted"
                  tabIndex={0}
                >
                  how it works
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Night Boost stacks many camera frames into one, averaging away sensor noise while
                amplifying the faintest traces of light — the same trick real starlight cameras use.
                In true 0-lux darkness no camera can see; keep a tiny light source (LED standby, moon,
                phone screen) for best results.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {NIGHT_LEVELS.map((l) => {
              const active = nightLevel === l.id
              return (
                <Tooltip key={l.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onNightLevel(l.id)}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-all ${
                        active
                          ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {l.icon}
                      <span className="hidden sm:inline">{l.name}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {l.hint}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>

        {/* AI detection */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>AI target tracking</SectionLabel>
            <span
              data-testid="detect-status"
              className="font-mono text-[10px] uppercase tracking-wider"
            >
              {params.detectMode === 'off' ? (
                <span className="text-zinc-600">standby</span>
              ) : detectState === 'loading' ? (
                <span className="text-amber-400">loading ai model…</span>
              ) : detectState === 'ready' ? (
                <span className="text-emerald-400">ai ready</span>
              ) : detectState === 'failed' ? (
                <span className="text-red-400">ai offline · thermal tracking</span>
              ) : (
                <span className="text-zinc-500">thermal tracking</span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {DETECT_MODES.map((m) => {
              const active = params.detectMode === m.id
              return (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChange({ detectMode: m.id })}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-all ${
                        active
                          ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      {m.icon}
                      <span className="hidden sm:inline">{m.name}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {m.hint}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
            {params.detectMode === 'faces'
              ? 'Face boxes show live temperature per person. Enable Alarm + set threshold (e.g. 37.5) to flag fevers — boxes turn red and the screen flashes.'
              : params.detectMode === 'hot'
                ? 'White brackets lock onto the hottest heat sources with live temperature chips (H1 = hottest).'
                : 'Target boxes disabled.'}
            {' '}All AI runs locally in your browser — no cloud, no uploads.
          </p>
        </div>

        {/* Sliders */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel>Sensor gain</SectionLabel>
              <span className="font-mono text-xs text-amber-400">×{params.gain.toFixed(1)}</span>
            </div>
            <Slider
              aria-label="Sensor gain"
              min={1}
              max={10}
              step={0.1}
              value={[params.gain]}
              onValueChange={([v]) => onChange({ gain: v })}
              className="[&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-thumb]]:bg-amber-400 [&_[data-slot=slider-range]]:bg-amber-500/60 [&_[data-slot=slider-track]]:bg-zinc-800"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel>Integration</SectionLabel>
              <span className="font-mono text-xs text-amber-400">{Math.round(params.integration * 100)}%</span>
            </div>
            <Slider
              aria-label="Frame integration"
              min={0}
              max={100}
              step={1}
              value={[Math.round(params.integration * 100)]}
              onValueChange={([v]) => onChange({ integration: v / 100 })}
              className="[&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-thumb]]:bg-amber-400 [&_[data-slot=slider-range]]:bg-amber-500/60 [&_[data-slot=slider-track]]:bg-zinc-800"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel>Contrast (DDE)</SectionLabel>
              <span className="font-mono text-xs text-amber-400">{params.contrast.toFixed(2)}</span>
            </div>
            <Slider
              aria-label="Contrast"
              min={0.6}
              max={1.8}
              step={0.05}
              value={[params.contrast]}
              onValueChange={([v]) => onChange({ contrast: v })}
              className="[&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-thumb]]:bg-amber-400 [&_[data-slot=slider-range]]:bg-amber-500/60 [&_[data-slot=slider-track]]:bg-zinc-800"
            />
          </div>
        </div>

        {/* Calibration + toggles */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <SectionLabel>Temp range calibration</SectionLabel>
            <div className="flex items-center gap-2">
              <Label htmlFor="min-temp" className="sr-only">Minimum temperature</Label>
              <NumberField
                id="min-temp"
                min={-50}
                max={Math.min(150, params.maxTemp - 1)}
                step={0.5}
                value={params.minTemp}
                onCommit={(v) => onChange({ minTemp: v })}
                className="h-8 w-24 border-zinc-800 bg-zinc-900 font-mono text-xs"
              />
              <span className="font-mono text-xs text-zinc-500">… °C</span>
              <Label htmlFor="max-temp" className="sr-only">Maximum temperature</Label>
              <NumberField
                id="max-temp"
                min={Math.max(-50, params.minTemp + 1)}
                max={150}
                step={0.5}
                value={params.maxTemp}
                onCommit={(v) => onChange({ maxTemp: v })}
                className="h-8 w-24 border-zinc-800 bg-zinc-900 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {(
              [
                ['mirror', 'Mirror'],
                ['crosshair', 'Spot'],
                ['scaleBar', 'Scale'],
                ['markers', 'Hot/Cold'],
                ['grain', 'Grain'],
                ['inertia', 'Heat trails'],
                ['isotherms', 'Isotherms'],
                ['sharpen', 'Detail+'],
                ['statsPanel', 'Measure'],
                ['alarmEnabled', 'Alarm'],
              ] as Array<[keyof ThermalParams, string]>
            ).map(([key, name]) => (
              <div key={key} className="flex items-center gap-2">
                <Switch
                  id={`toggle-${key}`}
                  checked={Boolean(params[key])}
                  onCheckedChange={(v) => onChange({ [key]: v } as Partial<ThermalParams>)}
                  className="data-[state=checked]:bg-amber-500"
                />
                <Label htmlFor={`toggle-${key}`} className="cursor-pointer text-xs text-zinc-300">
                  {name}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced tools */}
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
          <SectionLabel>Advanced tools</SectionLabel>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* Zoom */}
            <div className="flex items-center gap-2">
              <ZoomIn className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
              <div className="flex overflow-hidden rounded-md border border-zinc-800">
                {[1, 2, 4].map((z) => (
                  <button
                    key={z}
                    type="button"
                    aria-pressed={params.zoom === z}
                    onClick={() => onChange({ zoom: z })}
                    className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      params.zoom === z
                        ? 'bg-amber-500 text-black'
                        : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {z}×
                  </button>
                ))}
              </div>
            </div>

            {/* Unit */}
            <div className="flex overflow-hidden rounded-md border border-zinc-800">
              {(['C', 'F'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={params.unit === u}
                  onClick={() => onChange({ unit: u })}
                  className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    params.unit === u
                      ? 'bg-amber-500 text-black'
                      : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  °{u}
                </button>
              ))}
            </div>

            {/* Emissivity */}
            <div className="flex min-w-44 flex-1 items-center gap-2 sm:max-w-56">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">Emiss ε</span>
              <Slider
                aria-label="Emissivity"
                min={0.1}
                max={1}
                step={0.05}
                value={[params.emissivity]}
                onValueChange={([v]) => onChange({ emissivity: v })}
                className="[&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-thumb]]:bg-amber-400 [&_[data-slot=slider-range]]:bg-amber-500/60 [&_[data-slot=slider-track]]:bg-zinc-800"
              />
              <span className="w-10 shrink-0 text-right font-mono text-xs text-amber-400">{params.emissivity.toFixed(2)}</span>
            </div>

            {/* Alarm threshold */}
            <div className={`flex items-center gap-1.5 ${params.alarmEnabled ? '' : 'opacity-50'}`}>
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Alarm ≥</span>
              <NumberField
                aria-label="Alarm threshold"
                min={-50}
                max={150}
                step={1}
                disabled={!params.alarmEnabled}
                value={params.alarmTemp}
                onCommit={(v) => onChange({ alarmTemp: v })}
                className="h-7 w-20 border-zinc-800 bg-zinc-900 font-mono text-xs"
              />
            </div>

            {/* Calibration */}
            <Button
              onClick={onCalibrate}
              disabled={!started}
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-amber-500/50 bg-amber-500/10 px-2.5 font-mono text-[11px] text-amber-300 hover:bg-amber-500/20"
            >
              <Sparkles className="h-3 w-3" />
              2-pt calibrate
            </Button>
            {params.calA && params.calB && (
              <button
                type="button"
                onClick={() => onChange({ calA: null, calB: null })}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                calibrated · reset
              </button>
            )}

            {/* Spots */}
            <Button
              onClick={onClearSpots}
              disabled={spotCount === 0}
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-zinc-700 bg-zinc-900 px-2.5 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <Eraser className="h-3 w-3" />
              Clear spots ({spotCount})
            </Button>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
            Tip: click anywhere on the video to drop a measurement spot (max 3). Calibrate with two
            known references (e.g. ice water ≈ 0°C, your hand ≈ 33°C) for the most accurate readings.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
          <Button
            onClick={onPhoto}
            disabled={!started}
            className="h-10 gap-2 bg-amber-500 font-semibold text-black hover:bg-amber-400"
          >
            <Camera className="h-4 w-4" />
            Photo
          </Button>
          <Button
            onClick={onRecord}
            disabled={!started}
            variant="outline"
            className={`h-10 gap-2 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 ${
              recording ? 'border-red-500/60 text-red-400' : 'text-zinc-200'
            }`}
          >
            {recording ? <CircleStop className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            {recording ? 'Stop rec' : 'Record'}
          </Button>
          <Button
            onClick={onFlip}
            disabled={!started || !multiCam}
            variant="outline"
            className="h-10 gap-2 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            <SwitchCamera className="h-4 w-4" />
            Flip
          </Button>
          <Button
            onClick={onFullscreen}
            variant="outline"
            className="h-10 gap-2 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            <Maximize2 className="h-4 w-4" />
            Fullscreen
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
