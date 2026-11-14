# ASCII Animals: interactive hero background for abinbinu.in (spec v2)

> **Build spec for a coding agent.** Read the whole file before writing code.
> Build in the milestone order in §16. Commit after each milestone.
> **Stop after Milestone 2 and wait for review.**
>
> **Source of truth for the look:** `reference/butterfly-reference.html`. It's a working, tuned renderer.
> Open it in a browser, read its code, and match its look. When this spec and that file disagree about
> how something *looks*, the file wins.
> Other references: `reference/ascii-animals-reference.png` (frames from the video that inspired this) and
> `reference/before-after.png` (what went wrong in v1, and the target).

---

## 0. What changed from v1, and why

v1 drew animals from **hand-typed ASCII frames** (`".aaa..."` strings), used flat 2–3 colour palettes and drew
the glyph inside each cell at high contrast. The result looked like blobby blue spreadsheets. v2 changes that:

| v1 (looked bad) | v2 (do this) |
|---|---|
| Hand-typed ASCII frames, rotated and scaled with nearest-neighbour sampling | **Shapes built from simple geometry** (ellipses, capsules, circles), evaluated per cell in the animal's own coordinate space |
| 2–3 flat colours, checkerboard of `#` and `+` | **A dark→light colour ramp** (6–8 stops); every cell gets its own shade (lighting, rim, mottling) |
| Glyphs big and bright: the shape reads as text | Glyphs **small (≈56% of the cell) and low contrast**; they're texture |
| Every cell at full alpha, hard edges | **Soft edges:** an outer ring of dimmer cells |
| Flapping by swapping 2 frames, which pops | **Continuous motion:** wing width follows `fold(phase)` smoothly |
| Thin parts drawn as tiles, or missing | Antennae, legs, tentacles and veins are **glyph-only cells** (no tile) |
| Hard rectangular dim behind the hero text | **Soft dim** that fades out over 120 px |
| Cell size 15 px | **Cell size 9 px** default |

---

## 1. What we're building

The hero section of my portfolio gets an ambient, interactive background:

- A dark field of faint **character tiles** fills the section.
- On top of it, groups of **animals built from shaded character tiles** move around.
- **Seven animals**, one active at a time, picked from a switcher:
  **Butterfly · Jellyfish · Dragonfly · Koi · Frog · Crane · Crab**

| Action | Result |
|---|---|
| Click or tap anywhere that isn't a link or button | Nearby animals **scatter** away from that point |
| Click while **Koi** is active | Drops **food pellets**; koi swim over and eat them (they don't scatter) |
| Switcher pill | Current animals fly off-screen and the new animal flies in |
| Tweaks panel | Count, speed, cell size, background density, trails |

---

## 2. Hard constraints

- **TypeScript**, `strict: true`. **Zero runtime dependencies.** Dev dependencies: `typescript`, `vite`, `vitest`, `playwright` (for the visual QA script only).
- **One `<canvas>`** draws all the visuals. UI controls are plain DOM elements.
- **Performance:** 60 fps on a mid-range laptop at 1440p with default settings. Per-frame JS ≤ 4 ms.
  The reference file draws 23 butterflies in about 3 ms with software rendering.
- **Must not hurt page load:** start after first paint and load lazily. The module's bundle must be ≤ 25 KB min+gzip.
- **Framework-agnostic core**, plus a thin wrapper for whatever the portfolio uses (§14).
- Prefix every CSS class with `af-`. Inject the styles once and remove them in `destroy()`.
- No global keyboard shortcuts and no listeners on `window` except `resize` and `visibilitychange` (both removed on destroy).

---

## 3. Project layout

```
ascii-field/
  package.json
  tsconfig.json
  vite.config.ts
  index.html                      # demo; supports ?animal= ?t= ?seed= ?cell= ?count= ?debug
  ascii-animals-build-spec.md
  reference/
    butterfly-reference.html      # THE LOOK. Do not edit; port from it.
    ascii-animals-reference.png
    before-after.png
  scripts/
    shot.mjs                      # visual QA screenshots (§15.1)
  src/
    index.ts                      # createAsciiField(), the only public entry
    types.ts
    engine/
      loop.ts                     # rAF loop, dt clamping, pause/resume
      grid.ts                     # geometry, resize, DPR
      background.ts               # faint tile + glyph field (offscreen canvas) + shimmer
      cellBuffer.ts               # per-frame buffer + occupied list
      palettes.ts                 # colour ramps, registered per animal
      atlas.ts                    # pre-rendered tiles (palette × shade step) and glyph-only cells
      shapes.ts                   # ellipse / capsule / circle fields, softCov, smooth, forEachCell, stampLine
      trails.ts
      renderer.ts
      input.ts
      dimMask.ts                  # soft dim factor per cell
    math/ vec2.ts  rng.ts  noise.ts
    animals/ types.ts  registry.ts  butterfly.ts  jellyfish.ts  dragonfly.ts  koi.ts  frog.ts  crane.ts  crab.ts
    ui/ switcher.ts  tweaks.ts  hint.ts  styles.ts
    persist.ts
  test/ *.test.ts
```

---

## 4. Public API

```ts
export type AnimalId =
  | 'butterfly' | 'jellyfish' | 'dragonfly' | 'koi' | 'frog' | 'crane' | 'crab';

export interface Tweaks {
  density: number;    // animal count multiplier, 0.25–2, default 1
  speed: number;      // global speed multiplier, 0.25–2, default 1
  cellSize: number;   // CSS px per grid cell, 6–16, default 9
  bgDensity: number;  // fraction of background cells with a glyph, 0–1, default 0.32
  trails: boolean;    // dragonfly + jellyfish trails, default true
}

export interface AsciiFieldOptions {
  host: HTMLElement;              // area to cover; receives clicks. Must be position: relative.
  animal?: AnimalId;              // default: persisted choice, else 'butterfly'
  theme?: 'dark' | 'light';       // default 'dark'
  ui?: { switcher?: 'top' | 'bottom' | false; tweaks?: boolean; hint?: boolean }; // defaults 'bottom', true, true
  tweaks?: Partial<Tweaks>;
  persist?: boolean;              // localStorage, default true
  dimSelector?: string;           // default '[data-af-dim]'
  seed?: number;
  debug?: boolean;
}

export interface AsciiField {
  setAnimal(id: AnimalId): void;
  setTweaks(t: Partial<Tweaks>): void;
  pause(): void;
  resume(): void;
  destroy(): void;   // removes canvas, UI, styles, listeners, observers; no leaks
}

export function createAsciiField(opts: AsciiFieldOptions): AsciiField;
```

`createAsciiField` prepends a `<canvas class="af-canvas">` to `host` with
`position:absolute; inset:0; z-index:0; pointer-events:none`.

---

## 5. Look rules (apply to every animal)

1. **Shapes come from geometry, not typed text.** Every animal is a set of parts (ellipse, capsule, circle) evaluated per cell in local space (§6.4).
2. **Shade every cell.** Map each cell to a 0–1 shade on the animal's colour ramp. Build the shade from:
   - **Lighting:** brighter toward the parts that catch light (wing tips, top of a jellyfish bell, the fish's back).
   - **Rim:** darker near the shape's edge, `-50%` over the outer 30%.
   - **Joints:** slightly darker where parts meet the body.
   - **Mottling:** `±0.1` per-cell noise, hashed from the animal's **local** coordinates and its id, so the pattern moves with the animal and never sparkles.
   - **Highlights:** 1–3 small bright spots per animal (shade ≈ 0.97).
3. **Soft edges.** Coverage fades from 1 to 0 across the shape's edge, `softCov(e, 0.84, 1.12)`. Coverage becomes the tile's alpha, so every shape has a ring of dim tiles around it.
4. **Tiles, not text.** A tile is a rounded square:
   - The gap is 16% of the cell and the corner radius is 18%.
   - The glyph sits inside at **56% of the cell size**. It's 32% darker than the tile on light tiles and 16% lighter on dark tiles.
   - The glyph is picked from `" .:-=+*#%@"` by shade.
5. **Thin parts are glyph-only.** Antennae, beaks, legs on cranes, tentacles and dragonfly wing veins get no tile. Draw a line glyph (`- \ | /`) that matches the segment's on-screen angle, with `o` or `.` at the tips, at alpha 0.35–0.6.
6. **Motion is continuous.** Wings, legs and bells deform with smooth functions of a phase value. Never swap 2–3 fixed frames.
7. **Scale:** cells are 8–10 px, and animals are 12–20 cells across at scale 1.
8. **Dimming is soft.** Behind `[data-af-dim]` elements, alpha is multiplied by `0.3 + 0.7 × smooth(0, 120px, distance to rect)`.
9. **Depth per animal.** Each entity has a random `z`. Its parts stamp with priority `z + partOffset`, so overlapping animals stay whole instead of interleaving.
10. **Check by looking.** Run the visual QA loop (§15.1) for every animal before calling it done.

---

## 6. Rendering pipeline

Port it from `reference/butterfly-reference.html`. Short version:

### 6.1 Grid and canvas
- `cols = ceil(w / cell)`, `rows = ceil(h / cell)`.
- Canvas backing size = CSS size × `dpr`, where `dpr = min(devicePixelRatio, 2)`.
- Use a `ResizeObserver` on the host, debounced by 100 ms. On resize, rebuild the grid, background, atlas and dim mask, and keep the existing entities.

### 6.2 Background
- Draw it once to an offscreen canvas.
- Fill with `#0a0a0c`.
- Every cell gets a faint rounded tile, `rgba(255,255,255,0.022)`.
- 32% of cells also get a glyph from ``.,:;'`-_=+|/\`` at alpha 0.04–0.10.
- **Shimmer:** about 1% of cells per second get re-rolled.
- **Light theme:** fill `#fafafa`, tiles `rgba(0,0,0,0.03)`, glyphs `#0a0a0a`.

### 6.3 Cell buffer
```ts
alpha: Float32Array; key: Uint16Array; pri: Float32Array; frame: Uint32Array;
occ: Int32Array; occN: number;          // list of cells written this frame (no full-grid scans)
stamp(col, row, key, alpha, pri)        // first write this frame registers the cell; higher pri wins
```
`key` encodes the atlas row and column: `row * 64 + col`. Row `2p` holds the tiles for palette `p`; row `2p + 1` holds its glyph-only cells.

### 6.4 Shape evaluation (replaces v1's sprite sampler)
For each entity, loop over the cells in its bounding box. Convert each cell centre to **local space**, measured in cells at scale 1:
```
forward f = (cos h, sin h)        right r = (-sin h, cos h)       // h = drawHeading
d = cellCentre - entityPos
u =  (d · r) / (cell × scale)     // + to the animal's right
v = -(d · f) / (cell × scale)     // head is at negative v
```
Evaluate the animal's parts at `(u, v)`. Each part gives a coverage and a shade, and you `stamp()` the result.
Thin parts are stamped by walking a polyline in local space, transforming each point to world space, and stamping glyph-only cells (`stampLine`).

Helpers for `engine/shapes.ts`:
```ts
ellipse(x, y, cx, cy, rx, ry, rot): number  // <1 inside, 1 on the edge
capsule(x, y, ax, ay, bx, by): number       // distance to segment, in cells
softCov(e, inner = 0.84, outer = 1.12)      // = smooth(outer, inner, e)
smooth(a, b, x)                             // smoothstep (works with a > b, as in the reference)
lineGlyph(screenAngle): '-' | '\\' | '|' | '/'
```

### 6.5 Atlas and drawing
- **Tiles:** for each palette, pre-render 24 shade steps, each a rounded tile with its glyph (rule 4). Pre-render its glyph-only cells too (`. : - | / \ o ·`, in the ramp colour at 0.7).
- **Drawing order:** background → trails → buffer.
- For each occupied cell: `globalAlpha = alpha × dim`, then one `drawImage` from the atlas. Never call `fillText` per frame.

### 6.6 Trails
- An intensity buffer that decays by `exp(-dt / tau)`.
- Draw trail cells as glyph-only `. : - = +` according to intensity, at alpha `0.6 × intensity`.

### 6.7 Dim mask
A `Float32Array` per cell, computed after layout changes with rule 8. It's applied at draw time, not when stamping.

---

## 7. Animal recipes

All numbers are in local cells at scale 1, with `u` pointing right and `v` pointing back (the head is at negative `v`).
**The butterfly numbers are tuned and verified.** The others are **starting points**: tune them with the QA loop (§15.1) against `ascii-animals-reference.png`.

### 7.1 Butterfly (verified, matches the reference file)
- **Ramp:** `#06101e #0c2443 #17497e #2a75b8 #449ad9 #6cb7ec #a3d6f7 #eef8ff`. Body ramp: `#0b0f1a #182033 #28344d #3e4d6b #5b6b8c`.
- **Fold:** `fold = 0.16 + 0.84 × sqrt(|cos(phase)|)`. The square root keeps the wings open most of the time. The wings are evaluated at `ax = |u| / fold` (mirrored).
- **Forewing:** `ellipse(ax, v, 4.4, -2.5, 4.4, 2.5, -0.72)`.
- **Hindwing:** `ellipse(ax, v, 3.0, 2.5, 2.9, 2.2, 0.8)`. Take `e = min(fore, hind)` and `cov = softCov(e)`.
- **Wing shade:**
  - Start at `0.34 + 0.5 × clamp01(ax / 8)`.
  - ±0.05 for forewing vs hindwing.
  - Rim: `-0.5 × smooth(0.7, 1.0, e) × sh`.
  - Root: `-0.12 × smooth(1.4, 0, ax)`.
  - Mottling: `±0.1`, hashed from `floor(ax × 1.8), floor(v × 1.8)`, the side and the id.
  - Tip spots (shade 0.97) at `(6.6, -4.4) r 0.8` and `(6.9, -2.9) r 0.6`.
  - Folded wings read darker: `sh × (0.62 + 0.38 × fold)`.
- **Body:**
  - A capsule along `v` from −3.0 to 3.6, radius 0.75 at the front and 0.6 at the back, plus a head circle at `(0, -3.9)` with radius about 0.6.
  - Body ramp. Priority `z + 0.5`.
- **Antennae:** glyph-only. 8 points per side along `u = ±(0.3 + 0.5t + 1.4t²)`, `v = -4.6 - 3.0t`, with `o` at the tip.
- **Bounding radius:** 9.6 cells.

### 7.2 Jellyfish (starting point)
- **Ramp:** `#12051a #2e0b3d #5b1670 #8a2a9e #b44fc4 #d57fe0 #efb6f5 #fff0ff`.
- **Bell:**
  - The upper part of `ellipse(u, v, 0, 0, 3.2, 2.6, 0)`, cut where `v > 0.6 + 0.3 × sin(u × 2.2)`, which gives a scalloped rim.
  - **Pulse:** `rx × (1 + 0.12p)` and `ry × (1 - 0.1p)`, with `p = sin(pulsePhase)`.
- **Bell shade:**
  - Start at `0.35 + 0.45 × clamp01(-v / 2.6)`, so the top is lighter.
  - Add `+0.15` along the bottom rim band.
  - An inner core `ellipse(u, v, 0, -0.3, 1.6, 1.2, 0)` gets `-0.15`.
  - Usual rim darkening, mottling, and one highlight near the top.
- **Tentacles:** 4 glyph-only chains of 8–10 points hanging from the rim, using `: ' .`. Alpha fades from 0.55 down to 0.2 toward the tips.

### 7.3 Dragonfly (starting point)
- **Ramp:** `#03140d #073524 #0c5e3e #13875a #22b07a #4fd39b #a7f0cf #effff8`.
- **Body:**
  - **Abdomen:** a capsule from `v = -1.0` to `v = 5.8`, radius 0.45, with banding (`floor(v)` parity alternates shade 0.55 and 0.75).
  - **Thorax:** `ellipse(0, -1.8, 0.85, 1.2)`.
  - **Head:** `(0, -3.4) r 0.75`, with two eye tiles at `(±0.5, -3.6)` at shade 0.97.
- **Wings:** two pairs of long thin ellipses: fore `(±3.0, -1.7) r (3.1, 0.75)` and hind `(±2.8, -0.5) r (2.9, 0.8)`.
  - Draw them as glyph-only cells: `.` or `:` inside, `-` on the edge, light grey-cyan at alpha 0.35, with a 25 Hz shimmer of ±0.12 rad.
- **Trail:** while darting, write the abdomen cells into the trail buffer (`tau 0.25 s`).

### 7.4 Koi (starting point)
- **Body:**
  - A spine of 10 segments, spaced 0.9 cells. Each segment is a disc whose radius tapers from 1.6 at the head to 0.5 at the tail.
  - **Shade:** lighter along the centre of the back, `+0.25 × (1 - |offset| / r)`, darker at the sides.
  - **Fins:** pectoral fins at segment 2 are small ellipses at alpha 0.6.
  - **Tail:** two splayed ellipses after the last segment, with twice the wiggle amplitude.
  - **Eyes:** two dark cells on the head.
- **Variant ramps** (each cell picks its ramp from the fish's patch pattern; the pattern noise is hashed from segment index and side):

  | Ramp | Stops |
  |---|---|
  | white | `#1a1a1d #3a3a40 #8a8d96 #d9dce3 #ffffff` |
  | red | `#2a0505 #6b0d0d #b91c1c #e5483c #ff8a75` |
  | orange | `#2a1203 #6b2a06 #c2410c #f97316 #fdba74` |
  | gold | `#2a2003 #6b5306 #ca8a04 #facc15 #fef08a` |
  | black | `#050608 #14171d #262b35 #3c4352` |
  | brown | `#1c0d03 #4a2306 #92400e #b45309 #e0a15c` |

  kohaku = white + red patches · showa = black + red + white · ogon = orange · yamabuki = gold · chagoi = brown.

### 7.5 Frog (starting point)
- **Ramp:** `#04140a #0a2e16 #145c2a #1f8a3c #34b553 #6fd987 #b8f2c6 #f0fff4`.
- **Body and head:**
  - **Body:** `ellipse(u, v, 0, 0.4, 2.4, 2.9)`.
  - **Head:** `ellipse(u, v, 0, -2.2, 2.0, 1.5)`.
  - **Eyes:** circles at `(±1.3, -2.9) r 0.75`, shade 0.97, each with a dark pupil cell.
  - **Shade:** a lighter stripe down the back and darker sides; spots where the noise is above 0.8 get `-0.2`.
- **Hind legs:** capsules thigh `(±1.8, 1.6)→(±3.4, 0.8)` and shin `(±3.4, 0.8)→(±3.0, 3.4)`, with a foot ellipse at `(±3.3, 3.9)`.
  - **Jump:** blend the shin end toward `(±1.6, 6.5)` by `jumpPhase`, so the legs stretch back.
- **Front legs:** a capsule `(±1.7, -1.2)→(±2.9, -2.2)`.

### 7.6 Crane (starting point)
- **Ramps:**
  - white: `#16181d #3a3f4a #7d8494 #c4c9d4 #eef1f6 #ffffff`
  - black wingtips: `#050607 #111318 #22262e #343a45`
  - crown: one `#ef4444` tile on the head
- **Body:** `ellipse(0, 0.5, 0.9, 2.6)`.
- **Neck and head:** a neck capsule from `(0, -1.8)` to `(0, -4.8)` with radius 0.35, and a head circle at `(0, -5.2)` with radius 0.55.
- **Thin parts:** the beak and the trailing legs, from `(±0.3, 2.8)` to `(±0.4, 6.0)`, are glyph-only.
- **Wings:** each is `ellipse(±4.6, -0.2, 4.8, 1.3, ±0.08)`.
  - Where `ax > 7`, use the black-tip ramp.
  - **Flap:** span factor `0.55 + 0.45 × cos(phase)` applied to `ax`.
  - The trailing edge is darker.

### 7.7 Crab (starting point)
- **Ramp:** `#1a0303 #420808 #7f1212 #b91c1c #e2463b #f7857a #ffd0c9`.
- **Body:** `ellipse(0, 0, 3.0, 2.0)`, wider than it is tall. Shade: lighter at the top centre, with rim darkening and mottling.
- **Eyes:** a `|` stalk plus a bright tile at `(±0.9, -2.4)`.
- **Claws:**
  - Arm capsule `(±2.2, -1.2)→(±3.4, -2.6)`.
  - Pincer: two small ellipses around `(±3.6, -3.3)` with a notch between them.
  - **Claws-up:** raise the pincers to `v = -4.0` and open the notch.
- **Legs:** 3 per side, thin capsules (radius 0.3) from `(±2.6, -0.4 + 0.8k)` outward to `(±4.4, 0.2 + 0.9k)`. The tips lift (the leg shortens 20%) in alternating gait.
- **Heading:** the body faces `-v`, and the crab walks along `±u`.

---

## 8. Simulation

### 8.1 Loop
```ts
const dt = Math.min((now - last) / 1000, 1 / 20) * tweaks.speed;
```

### 8.2 Entity
```ts
interface Entity {
  id: number; z: number;                 // z: random 0..1, stamp priority
  x: number; y: number; vx: number; vy: number;
  heading: number; drawHeading: number;  // drawHeading smooths toward velocity direction (rate 6/s)
  scale: number; phase: number; state: string; stateT: number;
  panic: number; seed: number; exiting?: boolean; data?: unknown;
}
interface AnimalDef {
  id: AnimalId; label: string; dot: string; baseCount: number; radius: number; // bounding radius, cells
  clickMode: 'scatter' | 'feed'; edge: 'wrap' | 'soft' | 'wrap-vertical';
  palettes: Record<string, string[]>;
  spawn(world, rng, fromEdge: boolean): Entity;
  update(e, dt, world): void;
  render(e, stamper, world): void;
  onScatter?(e, from, strength): void;
}
```

### 8.3 Counts
`count = round(baseCount × (hostArea / (1920×1080)) × density × (hostWidth < 768 ? 0.6 : 1))`, clamped to `[4, 80]`.

| Animal | Butterfly | Jellyfish | Dragonfly | Koi | Frog | Crane | Crab |
|---|---|---|---|---|---|---|---|
| Base count | 26 | 14 | 12 | 22 | 16 | 10 | 18 |

### 8.4 Edges
- `wrap`: re-enter from the opposite side, with a margin of `radius × scale × cell`.
- `wrap-vertical`: wrap top↔bottom.
- `soft`: inside a 60 px band from each edge, steer back toward the centre.

### 8.5 Helpers
- Use the seeded RNG everywhere (mulberry32); never `Math.random()`.
- Smooth value noise for wandering.
- Reynolds steering. O(n²) neighbour checks are fine.

---

## 9. Animal behaviour

Speeds are px/s at `speed = 1`.

### 9.1 Butterfly (`wrap`): as in the reference file
- **Speed and steering:** speed 36–62. The heading wanders by `(noise(t × 0.4 + seed) - 0.5) × 3.4 × dt`.
- **Velocity:** relaxes toward `heading × speed × (1 + 2.2 × panic)` at rate 1.8/s.
- **Bob:** a sideways bob of `sin(phase × 0.5) × 12` px/s.
- **Flap:** 3.4–4.8 Hz, faster when panicked: `× (1 + 0.9 × panic)`.

### 9.2 Jellyfish (`wrap-vertical`)
- **Heading:** mostly upward, tilted up to ±0.35 rad with noise.
- **Pulse cycle (2–3 s):** contract for 0.4 s with an impulse of 60–90 px/s along the heading; relax with drag of 1.5/s.
- **Tentacles:** follow-the-leader chains, so they trail and sway.

### 9.3 Dragonfly (`wrap`)
- **States:** `hover` for 0.3–1.2 s (jitter ±1.5 px), then `dart` for 0.15–0.35 s (400–700 px/s toward a new heading within ±60°, or a random heading 30% of the time).
- **Trail:** while darting, write the body into the trail buffer.

### 9.4 Koi (`soft`, `clickMode: feed`)
- **Movement:** boids. Max speed 60–90.

  | Rule | Radius | Weight |
  |---|---|---|
  | Separation | 40 px | 1.5 |
  | Alignment | 90 px | 1.0 |
  | Cohesion | 120 px | 0.8 |
  | Wander | — | 0.4 |
- **Swimming wiggle:** `sin(phase × 6 - i × 0.6) × amp × (i / n)`.
- **Feeding:**
  - **Pellets:** a click drops 6–12 pellets within 24 px of the click. Each lasts 6 s, drifts and shrinks, and is drawn as a glyph-only `o` or `·` in `#fde68a`.
  - **Seeking:** koi within 450 px seek the nearest pellet with weight 2.5.
  - **Eating:** a koi's head within 10 px eats the pellet and leaves a ripple ring.
- **Koi never scatter.**

### 9.5 Frog (`soft`)
- **States:** `sit` (1–4 s, blink every 2–5 s) → `crouch` (0.15 s) → `jump` (0.35–0.5 s; 80–180 px; scale 1 → 1.3 → 1; legs extend) → `land` (0.1 s) → `sit`.
- At the end of `sit`, turn the heading by up to ±90°.
- **On scatter:** go straight to `jump`, heading away from the click, with distance × 1.5.

### 9.6 Crane (`wrap`)
- **Flocks:** groups of 2–4 in a loose V.
- **Flight:** glide at 70–110 px/s, turning at most 0.4 rad/s.
- **Wing cycle:** glide for 1–3 s, then flap for 1–2 s (cycle 0.6–0.9 s).
- **On scatter:** flap fast (cycle 0.25 s) while `panic > 0`.

### 9.7 Crab (`soft`)
- **States:** `walk` sideways (0.5–2 s at 40–80 px/s, gait about 6 Hz), then `pause` (0.3–1.5 s).
- **On scatter:** claws up for 0.4 s, then run away at 3× speed.

---

## 10. Interaction

- **Pointer:** listen for `pointerdown` on the host. Ignore the event if `button !== 0`, or if the target is inside `a, button, input, textarea, select, label, [role="button"], [data-af-ignore]` or the module's own UI. Don't call `preventDefault`.
- **Scatter:**
  - Radius: `R = 240 px × clamp(min(w, h) / 900, 0.6, 1.4)`.
  - Impulse: `900 × (1 - d/R)²` px/s, pointing away from the click.
  - Set the entity's heading to the flee direction and set `panic`. Panic decays at 0.8/s.
  - Draw a ripple ring of glyph-only `·` cells that expands over 0.35 s and fades by 0.45 s.
- **Optional hover:** butterflies and cranes gently avoid the pointer, within 70 px.

---

## 11. UI
- **Look:** dark glass pills. Background `rgba(20,20,24,.6)`, `backdrop-filter: blur(8px)`, 1 px border `rgba(255,255,255,.08)`, text `#a1a1aa` at 12 px. The active pill uses `#fafafa` on `rgba(255,255,255,.08)`.
- **Switcher:** seven pills, each with a coloured dot.
  - Dot colours: butterfly `#449ad9`, jellyfish `#d57fe0`, dragonfly `#4fd39b`, koi `#facc15`, frog `#34b553`, crane `#eef1f6`, crab `#e2463b`.
  - Accessibility: `role="radiogroup"`, with arrow keys moving the selection and a roving `tabindex`.
  - Under 480 px wide, show only the dots.
- **Tweaks:** a popover with sliders (density, speed, cell size, background density), a trails toggle and a Reset link. `Esc` or clicking outside closes it.
- **Hint:** `click to scatter` or `click to feed`, in the bottom-left corner. It fades out after the visitor's third click and stays hidden on later visits.
- **Persistence:** key `af:v1`, holding `{ animal, tweaks, hintDismissed }`. Wrap storage calls in try/catch.

## 12. Switching animals
- Current entities exit toward the nearest edge at 3× speed, fading out over 0.8 s.
- The new animal's entities spawn just outside the edges, heading inward, staggered over 0.6 s.
- Allow up to 2× the normal entity count while the switch is running.

## 13. Performance, accessibility, mobile
- **Pausing:** pause when `document.hidden`, and when the host is less than 1% visible (`IntersectionObserver`).
- **Reduced motion:** with `prefers-reduced-motion`, render a single still frame after simulating 2 s, and run no loop.
- **Accessibility:** the canvas gets `aria-hidden="true"`, and all controls are real, focusable buttons.
- **Mobile:** use 0.6× the animal count and an 8 px cell size when the host is narrower than 768 px.
- **Allocation:** no allocations per frame; reuse typed arrays and the occupied list.

---

## 14. Integrating into the portfolio (Milestone 7)
**Step 1: detect the stack.** Check the portfolio's `package.json` for `next`, `react`, `astro`, `vue`, `svelte` or `vite`. If there's no `package.json`, treat it as plain HTML. **If the stack is unclear, ask me.**
**Step 2: copy the module.** If the site has a build step, copy `src/` to `src/lib/ascii-field/`. For plain HTML, build one ES module, `assets/js/ascii-field.js`.
**Step 3: mount it on the hero.**
- The hero gets `position: relative; overflow: hidden`.
- Its content gets `position: relative; z-index: 1`.
- Put `data-af-dim` on the name and tagline block.
- Use `theme: 'light'` only if the hero section is light.

**React / Next.js**
```tsx
'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export function AsciiHero({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let field: { destroy(): void } | undefined; let cancelled = false;
    import('@/lib/ascii-field').then(({ createAsciiField }) => {
      if (!cancelled && hostRef.current) field = createAsciiField({ host: hostRef.current });
    });
    return () => { cancelled = true; field?.destroy(); };
  }, []);
  return <section ref={hostRef} style={{ position: 'relative', overflow: 'hidden' }}>{children}</section>;
}
```
**Astro / plain HTML**
```html
<section id="hero" style="position:relative;overflow:hidden">
  <div data-af-dim style="position:relative;z-index:1"><!-- hero content --></div>
</section>
<script type="module">
  import { createAsciiField } from './assets/js/ascii-field.js'; // Astro: '../lib/ascii-field'
  const host = document.getElementById('hero');
  const start = () => createAsciiField({ host });
  'requestIdleCallback' in window ? requestIdleCallback(start) : setTimeout(start, 200);
</script>
```
Only touch the hero component and the place that imports it.

---

## 15. Visual QA and testing

### 15.1 Visual QA loop (required for every animal)
`scripts/shot.mjs` opens the demo in headless Chromium at 1833×987 and saves still frames:
```js
import { chromium } from 'playwright';
const [url, out, ...queries] = process.argv.slice(2);   // e.g. http://localhost:5173/ shots/koi "animal=koi&t=4" "animal=koi&t=6&seed=3"
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1833, height: 987 } });
for (const [i, q] of queries.entries()) {
  await page.goto(`${url}?${q}`); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}_${i}.png` });
}
await browser.close();
```
- The demo must support `?animal=&t=&seed=&cell=&count=`. With `t` set, simulate `t` seconds at a fixed 1/60 s step, render **one still frame**, and run no loop. That makes screenshots deterministic.
- For each animal, put the screenshot next to that animal's crop in `reference/ascii-animals-reference.png`, and check it against the look rules in §5:
  - [ ] The silhouette reads as the animal at a glance, at scale 0.75 and at 1.3.
  - [ ] Shading is visible: lighter and darker regions, a darker rim, at least one highlight.
  - [ ] Glyphs read as texture, not text.
  - [ ] Edges are soft, with a dim outer ring.
  - [ ] Thin parts are glyph-only.
  - [ ] Overlapping animals stay whole.
  - [ ] Text behind `[data-af-dim]` stays readable, with no hard rectangle.
- If you can't view images yourself, save the shots to `qa/` and stop for review.

### 15.2 Unit tests (vitest, fixed seed)
- `vec2`, RNG determinism, `ellipse` / `capsule` / `softCov` values.
- The local-space transform: a point 2 cells ahead of an entity heading 0 rad has `v = -2`, `u = 0`.
- `stamp` priority and the occupied list.
- The count formula.
- Scatter direction and falloff; koi are unaffected.
- Feeding: pellet eaten within 10 px; pellets expire at 6 s.
- Switching: exiting entities are gone within 0.8 s.
- `destroy()` leaves no nodes and no scheduled rAF.

### 15.3 Manual checklist (`CHECKLIST.md`)
- All 7 animals; scatter and feeding; the link doesn't scatter.
- Switcher works with the keyboard; tweaks persist after a reload.
- Resizing works from 320 px wide up to 4K.
- Mobile tap works and scrolling still works.
- Reduced motion shows a still frame.
- No work happens while the tab is hidden or the hero is off-screen.

---

## 16. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M1** | Scaffold, grid, background | Canvas fills the host and is sharp at DPR 2; tile background with shimmer; resizing works; ≤ 1 ms/frame |
| **M2** | Port the reference renderer and butterflies to TS | Engine (buffer, atlas, shapes, dim mask, input) in TS. Butterflies from §7.1 and §9.1. **Side-by-side screenshots of `index.html?t=4&seed=7` and `reference/butterfly-reference.html?t=4&seed=7` look equivalent** (exact positions may differ). Scatter works; the link is ignored; debug overlay works. **→ Stop for review.** |
| **M3** | Koi | §7.4 and §9.4; passes the QA loop |
| **M4** | Remaining 5 animals | §7.2, 7.3, 7.5, 7.6, 7.7 and §9; each passes the QA loop; `qa/*.png` committed |
| **M5** | UI, transitions, persistence | §11 and §12 |
| **M6** | Hardening | §13; unit tests pass; bundle ≤ 25 KB gzip; 60 fps at 1440p; no leaks |
| **M7** | Integrate into portfolio | §14; Lighthouse performance drops by no more than 3 points; one clean commit |

## 17. Definition of done
- [ ] All 7 animals pass the QA checklist in §15.1.
- [ ] Scatter works for every animal except koi; feeding works for koi.
- [ ] Switcher, Tweaks and hint work with mouse, touch and keyboard; choices persist.
- [ ] Reduced motion is respected; the loop pauses when hidden or off-screen.
- [ ] 60 fps at 1440p; ≤ 25 KB gzip; zero runtime dependencies; `destroy()` leaves nothing behind.
- [ ] Live on the portfolio hero, with the text readable and no layout shift.
