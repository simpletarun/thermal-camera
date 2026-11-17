export interface PaletteDef {
  id: string
  name: string
  /** Control points: [rgb, t] — piecewise-linearly interpolated into a 256-entry LUT. t: 0 (cold) -> 1 (hot) */
  points: Array<[[number, number, number], number]>
}

/**
 * Thermal-style color palettes (FLIR-inspired).
 */
export const PALETTES: PaletteDef[] = [
  {
    id: 'ironbow',
    name: 'Ironbow',
    points: [
      [[4, 2, 20], 0.0],
      [[36, 8, 96], 0.15],
      [[110, 22, 118], 0.3],
      [[180, 45, 85], 0.45],
      [[220, 90, 40], 0.6],
      [[245, 150, 30], 0.75],
      [[252, 210, 90], 0.88],
      [[255, 250, 220], 1.0],
    ],
  },
  {
    id: 'rainbow',
    name: 'Rainbow HC',
    points: [
      [[12, 8, 90], 0.0],
      [[0, 120, 220], 0.2],
      [[20, 220, 200], 0.35],
      [[60, 230, 80], 0.5],
      [[230, 230, 60], 0.65],
      [[240, 110, 40], 0.8],
      [[255, 40, 40], 1.0],
    ],
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    points: [
      [[0, 0, 0], 0.0],
      [[255, 255, 255], 1.0],
    ],
  },
  {
    id: 'hotmetal',
    name: 'Hot Metal',
    points: [
      [[0, 0, 0], 0.0],
      [[128, 0, 0], 0.3],
      [[230, 80, 0], 0.55],
      [[255, 200, 60], 0.75],
      [[255, 255, 240], 1.0],
    ],
  },
  {
    id: 'glowbow',
    name: 'Glowbow',
    points: [
      [[10, 4, 40], 0.0],
      [[120, 10, 110], 0.25],
      [[230, 60, 80], 0.5],
      [[255, 160, 60], 0.7],
      [[240, 240, 120], 0.9],
      [[255, 255, 255], 1.0],
    ],
  },
  {
    id: 'arctic',
    name: 'Arctic',
    points: [
      [[4, 6, 30], 0.0],
      [[10, 90, 120], 0.3],
      [[60, 180, 190], 0.6],
      [[170, 230, 235], 0.85],
      [[255, 255, 255], 1.0],
    ],
  },
  {
    id: 'lava',
    name: 'Lava',
    points: [
      [[0, 0, 0], 0.0],
      [[60, 0, 10], 0.25],
      [[160, 15, 15], 0.5],
      [[235, 80, 20], 0.7],
      [[255, 190, 60], 0.85],
      [[255, 255, 200], 1.0],
    ],
  },
  {
    id: 'whitehot',
    name: 'White Hot',
    points: [
      [[0, 0, 0], 0.0],
      [[64, 64, 64], 0.25],
      [[128, 128, 128], 0.5],
      [[192, 192, 192], 0.75],
      [[255, 255, 255], 1.0],
    ],
  },
  {
    id: 'blackhot',
    name: 'Black Hot',
    points: [
      [[255, 255, 255], 0.0],
      [[192, 192, 192], 0.25],
      [[128, 128, 128], 0.5],
      [[64, 64, 64], 0.75],
      [[0, 0, 0], 1.0],
    ],
  },
  {
    id: 'nightvision',
    name: 'Night Vision',
    points: [
      [[0, 0, 0], 0.0],
      [[8, 40, 16], 0.25],
      [[24, 120, 44], 0.5],
      [[90, 220, 110], 0.75],
      [[180, 255, 190], 0.9],
      [[235, 255, 235], 1.0],
    ],
  },
]

export function getPalette(id: string): PaletteDef {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

/** Build a 256x1 RGBA LUT (Uint8Array, 256*4 bytes) from palette control points. */
export function buildLut(def: PaletteDef): Uint8Array {
  const lut = new Uint8Array(256 * 4)
  const pts = [...def.points].sort((a, b) => a[1] - b[1])

  const sample = (t: number): [number, number, number] => {
    if (t <= pts[0][1]) return pts[0][0]
    if (t >= pts[pts.length - 1][1]) return pts[pts.length - 1][0]
    for (let i = 0; i < pts.length - 1; i++) {
      const [c0, t0] = pts[i]
      const [c1, t1] = pts[i + 1]
      if (t >= t0 && t <= t1) {
        const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
        return [
          c0[0] + (c1[0] - c0[0]) * f,
          c0[1] + (c1[1] - c0[1]) * f,
          c0[2] + (c1[2] - c0[2]) * f,
        ]
      }
    }
    return pts[pts.length - 1][0]
  }

  for (let i = 0; i < 256; i++) {
    const [r, g, b] = sample(i / 255)
    lut[i * 4] = Math.round(r)
    lut[i * 4 + 1] = Math.round(g)
    lut[i * 4 + 2] = Math.round(b)
    lut[i * 4 + 3] = 255
  }
  return lut
}

/** CSS linear-gradient string (bottom = cold, top = hot) for palette chips / legends. */
export function paletteGradientCss(def: PaletteDef): string {
  const stops = [...def.points]
    .sort((a, b) => a[1] - b[1])
    .map(([c, t]) => `rgb(${c[0]},${c[1]},${c[2]}) ${Math.round(t * 100)}%`)
    .join(', ')
  return `linear-gradient(to top, ${stops})`
}
