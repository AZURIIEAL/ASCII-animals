# ASCII Animals: interactive hero background for abinbinu.in

> **Build spec for a coding agent.** Read the whole file before writing code.
> Build in the milestone order in §15. Commit after each milestone.
> **Stop after Milestone 2 and wait for review** before continuing.
> Visual reference: `ascii-animals-reference.png`, sitting next to this file. It shows frames from the video that inspired this. Match its *feel*, but draw every sprite ourselves; don't copy it pixel for pixel.

---

## 1. What we're building

The hero section of my portfolio gets an ambient, interactive background:

- A dark field of faint **keyboard characters** fills the section.
- On top of it, groups of **animals made of coloured character cells** move around.
- **Seven animals**, one active at a time, picked from a switcher:
  **Butterfly · Jellyfish · Dragonfly · Koi · Frog · Crane · Crab**

Interactions:

| Action | Result |
|---|---|
| Click or tap anywhere that isn't a link or button | Nearby animals **scatter** away from that point |
| Click while **Koi** is active | Drops **food pellets**; koi swim over and eat them (they don't scatter) |
| Switcher pill | Current animals fly off-screen and the new animal flies in |
| Tweaks panel | Count, speed, cell size, background density, trails, style |

---

## 2. Hard constraints

- **TypeScript**, `strict: true`. **Zero runtime dependencies.** Dev dependencies only: `typescript`, `vite`, `vitest`.
- **One `<canvas>`** draws all the visuals. UI controls are plain DOM elements.
- **Performance:** 60 fps on a mid-range laptop at 1440p with default settings. Per-frame JS ≤ 4 ms.
- **Must not hurt page load:** start after first paint and load lazily. The module's bundle must be ≤ 25 KB min+gzip.
- **Framework-agnostic core**, plus a thin wrapper for whatever the portfolio uses (§13).
- Prefix every CSS class with `af-` (for *ascii field*) so nothing clashes with portfolio styles. Inject the styles once and remove them in `destroy()`.
- No global keyboard shortcuts and no listeners on `window` except `resize` and `visibilitychange` (both removed on destroy).

---

## 3. Project layout

Build it as a standalone project first, with its own demo page. Copy it into the portfolio in Milestone 7.

```
ascii-field/
  package.json
  tsconfig.json
  vite.config.ts            # dev server for demo + library build (ES module)
  index.html                # standalone demo: full-screen host + fake hero text
  ascii-animals-build-spec.md
  ascii-animals-reference.png
  src/
    index.ts                # createAsciiField() – the only public entry
    types.ts
    engine/
      loop.ts               # rAF loop, dt clamping, pause/resume
      grid.ts               # grid geometry, resize, DPR
      background.ts         # faint glyph field (offscreen canvas) + shimmer
      cellBuffer.ts         # per-frame cell buffer (typed arrays)
      trails.ts             # decaying intensity buffer
      atlas.ts              # glyph atlas (pre-rendered glyph tiles)
      renderer.ts           # draws background + trails + cell buffer
      sampler.ts            # stamps a sprite into the buffer with rotation/scale
      input.ts              # pointer handling, ignore rules, host-local coords
      dimMask.ts            # cells behind [data-af-dim] elements render dimmer
    math/
      vec2.ts
      rng.ts                # seeded RNG (mulberry32)
      noise.ts              # small 1D/2D value or simplex noise, no deps
    animals/
      types.ts              # AnimalDef, Entity
      registry.ts
      butterfly.ts
      jellyfish.ts
      dragonfly.ts
      koi.ts
      frog.ts
      crane.ts
      crab.ts
    ui/
      switcher.ts
      tweaks.ts
      hint.ts
      styles.ts             # CSS string injected once
    persist.ts              # localStorage (wrapped in try/catch)
  test/
    *.test.ts
```

---

## 4. Public API

```ts
export type AnimalId =
  | 'butterfly' | 'jellyfish' | 'dragonfly' | 'koi' | 'frog' | 'crane' | 'crab';

export interface Tweaks {
  density: number;            // animal count multiplier, 0.25–2, default 1
  speed: number;              // global speed multiplier, 0.25–2, default 1
  cellSize: number;           // CSS px per grid cell, 8–18, default 12
  bgDensity: number;          // fraction of background cells with a glyph, 0–1, default 0.55
  trails: boolean;            // dragonfly + jellyfish trails, default true
  style: 'blocks' | 'glyphs'; // filled cell + glyph, or glyph only. default 'blocks'
}

export interface AsciiFieldOptions {
  host: HTMLElement;          // area to cover; receives clicks. Must be position: relative.
  animal?: AnimalId;          // default: persisted choice, else 'butterfly'
  theme?: 'dark' | 'light';   // default 'dark'
  ui?: {
    switcher?: 'top' | 'bottom' | false; // default 'bottom' (portfolio nav is usually at top)
    tweaks?: boolean;                    // default true
    hint?: boolean;                      // default true
  };
  tweaks?: Partial<Tweaks>;
  persist?: boolean;          // remember animal + tweaks in localStorage, default true
  dimSelector?: string;       // elements whose area dims animals, default '[data-af-dim]'
  seed?: number;              // deterministic RNG for tests
  debug?: boolean;            // FPS / entity count / frame-ms overlay, default false
}

export interface AsciiField {
  setAnimal(id: AnimalId): void;
  setTweaks(t: Partial<Tweaks>): void;
  pause(): void;
  resume(): void;
  destroy(): void;            // removes canvas, UI, styles, listeners, observers — no leaks
}

export function createAsciiField(opts: AsciiFieldOptions): AsciiField;
```

`createAsciiField` appends a `<canvas class="af-canvas">` to `host` with
`position:absolute; inset:0; z-index:0; pointer-events:none`. Host content sits above it
(`position:relative; z-index:1`).

---

## 5. Rendering

### 5.1 Grid
- Cell size `c = tweaks.cellSize` in CSS px. `cols = ceil(w / c)`, `rows = ceil(h / c)`.
- Canvas backing size = CSS size × `dpr`, where `dpr = min(devicePixelRatio, 2)`. Call `ctx.setTransform(dpr,0,0,dpr,0,0)`.
- Watch the host with a `ResizeObserver`, debounced by 100 ms. On resize, rebuild the grid, background and atlas. **Keep the existing entities** and move them back inside the new bounds.

### 5.2 Background field
- The background colour is drawn on the canvas: dark `#0a0a0c`, light `#fafafa`.
- Each cell gets a glyph with probability `bgDensity`, picked from `` . , : ; ' ` - _ = + | / \ ``.
  - Each glyph gets its own alpha between 0.04 and 0.11.
  - Glyph colour: `#e5e7eb` in dark mode, `#0a0a0a` in light mode.
- Draw the field **once** to an offscreen canvas and copy it in with `drawImage` every frame.
- **Shimmer:** about 1% of background cells per second get a new glyph. Redraw only those cells on the offscreen canvas.

### 5.3 Cell buffer (rebuilt every frame)
```ts
class CellBuffer {
  cols: number; rows: number;
  color: Uint8Array;   // palette index, 0 = empty
  glyph: Uint8Array;   // index into glyph table
  alpha: Float32Array; // 0..1
  depth: Uint8Array;   // higher wins
  clear(): void;
  stamp(col: number, row: number, color: number, glyph: number, alpha: number, depth: number): void;
  // stamp writes only if depth >= existing depth; ignores out-of-bounds
}
```
- One **global colour table** of at most 64 entries. Each animal registers its colours at startup.
- **Light theme:** derive each colour by lowering its HSL lightness by about 20%, so animals stay visible on white.

### 5.4 Glyph atlas and drawing
- Create the tiles lazily: one tile per `(colorIndex, glyphIndex)` pair, `c × c` CSS px at `dpr`, drawn on an offscreen canvas.
  - Use a monospace font at about 0.8·c px, centred.
- For each occupied cell, depending on `style`:
  - `blocks`: fill a rect of `(c - 1) × (c - 1)` in the cell colour at `alpha × 0.45`, then draw the glyph tile at `alpha`, using a lighter tint of the same colour.
  - `glyphs`: draw only the glyph tile, at `alpha`.
- Set `globalAlpha` per cell. Calling `fillText` per cell per frame is **not allowed**; it's too slow.
- **Draw order:** background → trails → cell buffer.

### 5.5 Sprite sampler (rotation and scale)
Animals have a heading. To draw a sprite at any angle, **sample it into the grid**:

```
angle = e.heading - sprite.facing
for each grid cell (col, row) within the entity's bounding circle:
  wx = (col + 0.5) * c;  wy = (row + 0.5) * c          // cell centre, px
  dx = wx - e.x;         dy = wy - e.y
  lx = ( dx*cos(angle) + dy*sin(angle)) / (c * e.scale) // world → sprite space
  ly = (-dx*sin(angle) + dy*cos(angle)) / (c * e.scale)
  sx = floor(lx + anchorX);  sy = floor(ly + anchorY)
  if (sx, sy) inside frame and frame[sy][sx] is not '.' or ' ':
      buffer.stamp(col, row, palette[key].color, palette[key].glyph, alpha, depth)
```
- Bounding radius in cells: `ceil(hypot(w, h) / 2 * e.scale) + 1`.
- Nearest-neighbour sampling only. The chunky, stair-stepped diagonals are the look we want.

### 5.6 Trails
- A second buffer (`intensity: Float32Array`, `color: Uint8Array`).
- Each frame, multiply intensity by `exp(-dt / tau)`, with `tau` set per animal (≈ 0.25 s for dragonflies).
- Draw each trail cell with glyph `. : - = +` according to intensity, at `alpha = intensity × 0.6`.
- Skip trails entirely when `tweaks.trails` is false.

### 5.7 Dim mask (keeps hero text readable)
- After each resize, and when a `ResizeObserver` on those elements fires, read the bounding rects of elements matching `dimSelector`, relative to the host.
- Build a `Uint8Array` of cells that overlap those rects, padded by one cell.
- At draw time, multiply the alpha of those cells by **0.35**.

---

## 6. Sprites

### 6.1 Format
```ts
interface Sprite {
  frames: string[][];   // each frame = array of equal-length rows; all frames same size
  palette: Record<string, { color: string; glyph: string; alpha?: number }>;
  anchor?: [number, number]; // pivot in cells, default centre
  facing: number;       // radians the art faces: 0 = right, -Math.PI/2 = up
}
// '.' and ' ' are empty cells
```

### 6.2 Example: butterfly (starter art; refine it)
```ts
export const butterfly: Sprite = {
  facing: -Math.PI / 2,
  palette: {
    a: { color: '#2563eb', glyph: '#' },
    b: { color: '#60a5fa', glyph: '+' },
    k: { color: '#94a3b8', glyph: '|' },
  },
  frames: [
    [ // open
      '.aaa.....aaa.',
      'abbba.k.abbba',
      'abbbbakabbbba',
      '.abbbakabbba.',
      '..aaaakaaaa..',
      '..abbakabba..',
      '.abba.k.abba.',
      '.aaa.....aaa.',
    ],
    [ // closed (wings up)
      '....aa.aa....',
      '...abbkbba...',
      '...abbkbba...',
      '....abkba....',
      '....abkba....',
      '...abbkbba...',
      '....aakaa....',
      '.............',
    ],
  ],
};
```
Add a third "half-open" frame between these two so the flap looks smooth.

### 6.3 Sprite sheet for every animal

| Animal | Size (cells) | Frames | Palette | Base count\* | Scale |
|---|---|---|---|---|---|
| Butterfly | 13×8 | open, half, closed | `#1d4ed8 #3b82f6 #93c5fd`, body `#94a3b8` | 26 | 0.8–1.5 |
| Jellyfish | bell 9×6 + procedural tentacles | expanded, contracted | `#a21caf #d946ef #f0abfc`; tentacles `#f0abfc` @ 40% | 14 | 0.8–1.6 |
| Dragonfly | 15×9 (long thin body, 4 wings) | wings A, wings B | body `#059669 #34d399`, wings `#e2e8f0` @ 35%, eyes `#ecfeff`; trail `#34d399` | 12 | 0.7–1.2 |
| Koi | procedural (§8.4), 10–16 cells long | — | variants in §8.4 | 22 | 0.7–1.3 |
| Frog | 9×8; jump frame 9×11 | sit, blink, crouch, jump (stretched legs) | `#166534 #22c55e #86efac`, eyes `#f8fafc` + pupil `#0a0a0a` | 16 | 0.8–1.4 |
| Crane | 17×11 (wings spread, long neck and legs) | wings up, level, down | `#f1f5f9 #cbd5e1`, wingtips `#475569`, crown `#ef4444` | 10 | 0.9–1.4 |
| Crab | 13×7 | legs A, legs B, claws up | `#b91c1c #ef4444 #fca5a5`, eyes `#f8fafc` | 18 | 0.7–1.2 |

\* The base count is for a 1920×1080 host at `density = 1`. See §7.3.

Switcher dot colours: butterfly `#3b82f6`, jellyfish `#d946ef`, dragonfly `#34d399`,
koi `#eab308`, frog `#22c55e`, crane `#f1f5f9`, crab `#f87171`.

---

## 7. Simulation

### 7.1 Loop
```ts
function frame(now: number) {
  const raw = (now - last) / 1000; last = now;
  const dt = Math.min(raw, 1 / 20) * tweaks.speed; // clamp big gaps (tab switch)
  world.update(dt);
  renderer.draw(world);
  if (running) rafId = requestAnimationFrame(frame);
}
```

### 7.2 Entity
```ts
interface Entity {
  x: number; y: number;       // px, host-local
  vx: number; vy: number;
  heading: number;            // radians
  scale: number;
  phase: number;              // animation clock
  state: string;              // per-animal state machine
  stateT: number;             // time left in state
  panic: number;              // 0..1, decays; raises max speed after scatter
  exiting?: boolean;          // set during animal switch
  data?: unknown;             // per-animal extras (spine, tentacles, variant…)
}

interface AnimalDef {
  id: AnimalId; label: string; dot: string;
  baseCount: number;
  clickMode: 'scatter' | 'feed';
  edge: 'wrap' | 'soft' | 'wrap-vertical';
  spawn(world: World, rng: Rng, fromEdge: boolean): Entity;
  update(e: Entity, dt: number, world: World): void;
  render(e: Entity, buf: CellBuffer, trails: Trails, world: World): void;
  onScatter?(e: Entity, from: Vec2, strength: number): void; // optional custom reaction
}
```

### 7.3 Counts
`count = round(baseCount × (hostArea / (1920×1080)) × density × (hostWidth < 768 ? 0.6 : 1))`,
clamped to `[4, 80]`. If `density` changes, spawn or retire entities gradually, about 10 per second, instead of all at once.

### 7.4 Edges
- `wrap`: leaving one side re-enters from the opposite side. Use a margin equal to the bounding radius so animals never pop in or out of view.
- `wrap-vertical`: wrap top↔bottom; soft walls on the left and right.
- `soft`: inside a 60 px band from each edge, steer back toward the centre with a force proportional to depth.

### 7.5 Shared helpers
- Use the seeded RNG everywhere; never call `Math.random()`.
- `noise1(t)` and `noise2(x, y)` for wandering.
- Steering is Reynolds-style: `desired - velocity`, clamped to `maxForce`.
- Neighbour searches can be O(n²), because n ≤ 80. No spatial hash needed.

---

## 8. Animal behaviour

Speeds below are px/s at `speed = 1`.

### 8.1 Butterfly (`edge: wrap`)
- **Speed and steering:** speed 40–70. The heading wanders using `noise1(phase)`, turning at most 2 rad/s.
- **Look:** the sprite rotates toward the direction of travel, smoothed with a lerp of about 6/s. Add a small sideways bob: `sin(phase × 9) × 2 px`.
- **Flap:** cycle through the frames every 0.12–0.2 s. Pick the interval randomly per entity, so they don't flap in sync.

### 8.2 Jellyfish (`edge: wrap-vertical`)
- **Heading:** mostly upward, tilted up to ±0.35 rad, and the tilt slowly drifts with noise.
- **Pulse cycle:** each jellyfish repeats a cycle lasting 2–3 s.
  - **Contract** (0.4 s, contracted frame): add an impulse of 60–90 px/s along the heading.
  - **Relax:** expanded frame. Apply drag of 1.5/s.
- **Tentacles:**
  - 3–5 strands, each a chain of 6–10 points.
  - Each point follows the one before it at a fixed distance, lagging behind, so the strands trail and sway.
  - Draw them as dim `: ' .` glyphs.
  - When `trails` is on, also leave a faint trail.

### 8.3 Dragonfly (`edge: wrap`)
- **States:** `hover` for 0.3–1.2 s, then `dart` for 0.15–0.35 s, then back to `hover`.
  - **Hover:** small jitter of ±1.5 px. The wing frames flicker every 0.04 s.
  - **Dart:** 400–700 px/s toward a new heading, either within ±60° of the current one or fully random (30% chance).
- **Trail:** every frame, stamp the body cells into the trail buffer with `tau ≈ 0.25 s`. This gives the long, fading diagonal streaks seen in the reference.

### 8.4 Koi (`edge: soft`, `clickMode: feed`)
- **Body:** procedural, not a sprite.
  - A spine of 8–12 segments. Each segment follows the one before it at a fixed spacing of about 0.9 cells.
  - Draw a filled disc at each segment, with the radius tapering from 1.6 cells at the head to 0.5 at the tail.
  - Add two pectoral fins at segment 2, and a forked tail fan of 3 cells after the last segment.
  - **Swimming wiggle:** offset each segment sideways by `sin(phase × 6 - i × 0.6) × amplitude × (i / n)`.
- **Variants:**
  - Choose a variant per fish, with these weights:

    | Variant | Weight | Colours |
    |---|---|---|
    | kohaku | 35% | white `#f8fafc` body, red `#dc2626` patches |
    | showa | 20% | `#334155` + red + white |
    | ogon | 20% | `#f97316` / `#ea580c` |
    | yamabuki | 15% | `#eab308` / `#facc15` |
    | chagoi | 10% | `#92400e` / `#b45309` |

  - Patch patterns are a colour per segment, chosen when the fish spawns and stored in `data`.
  - Eyes: two `#0a0a0a` cells on the head when `scale ≥ 1`.
- **Movement:** boids. Max speed 60–90.

  | Rule | Radius | Weight |
  |---|---|---|
  | Separation | 40 px | 1.5 |
  | Alignment | 90 px | 1.0 |
  | Cohesion | 120 px | 0.8 |
  | Wander | — | 0.4 |
- **Feeding:**
  - **Pellets:** a click spawns 6–12 pellets within 24 px of the click. Each pellet lasts 6 s, drifts slowly and shrinks, then disappears. It's drawn as a `·` or `o` cell in `#fde68a`.
  - **Seeking:** koi within 450 px seek the nearest pellet with weight 2.5, which overrides the flocking rules while active.
  - **Eating:** when a koi's head is within 10 px of a pellet, remove the pellet. Spawn a ripple there: a ring of dim `.` cells whose radius grows from 0 to 3 cells over 0.5 s, then fades.
- **Koi never scatter.**

### 8.5 Frog (`edge: soft`)
- **States:** `sit` (1–4 s) → `crouch` (0.15 s) → `jump` (0.35–0.5 s) → `land` (0.1 s) → `sit`.
  - **Sit:** idle frame. Blink about every 2–5 s.
  - **Jump:** travel 80–180 px along the heading, easing in and out. The view is top-down, so show height by scaling the sprite 1.0 → 1.3 → 1.0 and using the stretched jump frame.
  - At the end of `sit`, turn the heading by a random amount up to ±90°.
- **On scatter:** go straight to `jump`, heading away from the click, with distance × 1.5.

### 8.6 Crane (`edge: wrap`)
- **Flocks:** spawn in groups of 2–4. Followers hold loose V-formation offsets behind the leader, with some noise in their positions.
- **Flight:** glide at 70–110 px/s along slowly curving paths, turning at most 0.4 rad/s.
- **Wing cycle:** alternate between gliding (1–3 s, level frame) and flapping (1–2 s, cycling up → level → down every 0.6–0.9 s).
- **On scatter:** flap fast (cycle 0.25 s) while `panic > 0`.

### 8.7 Crab (`edge: soft`)
- **Movement:** sideways. The body faces a mostly fixed direction, and the crab moves along its own x-axis, either left or right. The body angle drifts by up to ±0.2 rad.
- **States:** `walk` (0.5–2 s at 40–80 px/s, leg frames alternating every 0.08 s) → `pause` (0.3–1.5 s) → `walk`. Pick a new direction at random for each walk.
- **On scatter:** show the claws-up frame for 0.4 s, then run sideways away from the click at 3× speed.

---

## 9. Interaction

### 9.1 Pointer
- Listen for `pointerdown` on **host**. The canvas itself has `pointer-events: none`.
- Ignore the event if any of these is true:
  - `button !== 0`
  - The target is inside `a, button, input, textarea, select, label, [role="button"], [data-af-ignore]`
  - The target is inside the module's own UI
- Convert to host-local coordinates with `getBoundingClientRect()`.
- Taps count as clicks. Don't call `preventDefault`; scrolling must keep working on mobile.

### 9.2 Scatter (every animal except koi)
```
R = 240 px × clamp(min(w, h) / 900, 0.6, 1.4)
for each entity e with d = |e - p| < R:
  k = (1 - d / R)^2
  e.v += normalize(e - p) × 900 × k
  e.panic = max(e.panic, k)          // decays at 0.8/s
  def.onScatter?.(e, p, k)
maxSpeed_effective = maxSpeed × (1 + 2 × e.panic)
```
Also draw a quick ring of dim `.` cells at the click point. It expands to `R / c` cells over 0.35 s.

### 9.3 Optional hover (Milestone 6, only if time allows)
Butterflies and cranes gently steer around the pointer, within 70 px, with weight 0.6. Keep this subtle.

---

## 10. UI

All UI is DOM inside the host, with `position: absolute` and `z-index: 2`. Style it as small, dark "glass" pills:
- Background `rgba(20,20,24,.6)` with `backdrop-filter: blur(8px)`, a 1 px border `rgba(255,255,255,.08)`, and text `#a1a1aa` at 12 px.
- The active pill uses text `#fafafa` and background `rgba(255,255,255,.08)`.

### 10.1 Switcher
- **Layout:** a pill bar at the top or bottom centre of the host, per `ui.switcher`. Seven buttons, each with a coloured dot (§6.3) and a label.
- **Accessibility:** use `role="radiogroup"`, and give each button `role="radio"` and `aria-checked`.
  - Left and right arrow keys move the selection.
  - Use a roving `tabindex`, so only one pill sits in the tab order.
- **Small screens:** under 480 px, show only the dots and expose the labels through `aria-label` / `title`.

### 10.2 Tweaks panel
- **Layout:** a "Tweaks" button in the top-right corner of the host. It opens a small popover.
- **Controls:** a slider for each of density, speed, cell size and background density; a toggle for trails; a segmented control for style (blocks / glyphs); and a "Reset" link.
- **Closing:** clicking outside or pressing `Esc` closes it.
- Changes apply live. A cell-size change triggers a grid rebuild (§5.1).

### 10.3 Hint
- Small monospace text in the bottom-left corner, `#52525b`, 11 px: `click to scatter`, or `click to feed` for koi.
- Fade it out after the visitor's third click. Store that in the persisted state, so it stays hidden on later visits.

### 10.4 Persistence
Use the key `af:v1`, holding `{ animal, tweaks, hintDismissed }`. Wrap every `localStorage` call in try/catch, and fall back to in-memory state if storage throws.

---

## 11. Switching animals
1. Mark every current entity `exiting`.
   - Exiting entities steer toward the nearest edge at 3× max speed, and their alpha fades to 0 over 0.8 s.
   - Remove them when they're off-screen or the 0.8 s is up.
2. At the same time, spawn the new animal's entities **just outside a random edge**, heading inward, staggered over 0.6 s.
3. Allow up to 2× the normal entity count while the transition runs. Ignore clicks on the switcher for 300 ms after a switch.

---

## 12. Performance, accessibility, mobile
- **Pausing:** pause the loop on `document.hidden`. Also pause when an `IntersectionObserver` on the host reports the host is less than 1% visible.
- **Reduced motion:**
  - If `prefers-reduced-motion: reduce` is set, run no loop. Instead, simulate 2 s off-screen so the animals spread out naturally, then render **one still frame**.
  - Switching animals re-renders a new still frame, and clicks do nothing.
  - Listen for changes to that media query.
- **Accessibility:** the canvas gets `aria-hidden="true"`, and all controls are real, focusable buttons.
- **Mobile:**
  - Use 0.6× the animal count on narrow screens (§7.3).
  - Default the cell size to 10 when the host is narrower than 768 px.
  - Never block scrolling.
- **Allocation:** avoid creating objects every frame; reuse vectors and typed arrays.
- **Debug overlay:** shown with `debug: true` or `?debug` in the demo URL. It shows fps, entity count, average and p95 frame time in ms, and the number of occupied cells.

---

## 13. Integrating into the portfolio (Milestone 7)

**Step 1: detect the stack.** Check the portfolio repo's `package.json` for `next`, `react`, `astro`, `vue`, `svelte` or `vite`. If there's no `package.json`, treat it as plain HTML.
**If the stack is unclear, stop and ask me.**

**Step 2: copy the module.**
- If the site has a build step, copy `src/` into the portfolio as `src/lib/ascii-field/`.
- For plain HTML, build the library (`vite build --mode lib`) into one ES module, `assets/js/ascii-field.js`.

**Step 3: mount it on the hero section.**
- The hero needs `position: relative; overflow: hidden`.
- Hero content needs `position: relative; z-index: 1`.
- Put `data-af-dim` on the block containing my name and tagline, so the animals dim behind the text.
- If the site uses a light theme, pass `theme: 'light'`, unless the hero section is already dark.

**React / Next.js**
```tsx
'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function AsciiHero({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let field: { destroy(): void } | undefined;
    let cancelled = false;
    import('@/lib/ascii-field').then(({ createAsciiField }) => {
      if (!cancelled && hostRef.current) field = createAsciiField({ host: hostRef.current });
    });
    return () => { cancelled = true; field?.destroy(); };
  }, []);

  return (
    <section ref={hostRef} style={{ position: 'relative', overflow: 'hidden' }}>
      {children}
    </section>
  );
}
```

**Astro**
```astro
<section id="hero" class="hero">
  <div class="hero-content" data-af-dim><!-- name, tagline, CTAs --></div>
</section>
<style>
  .hero { position: relative; overflow: hidden; }
  .hero-content { position: relative; z-index: 1; }
</style>
<script>
  import { createAsciiField } from '../lib/ascii-field';
  const host = document.getElementById('hero');
  const start = () => host && createAsciiField({ host });
  'requestIdleCallback' in window ? requestIdleCallback(start) : setTimeout(start, 200);
</script>
```

**Plain HTML**
```html
<section id="hero" style="position:relative;overflow:hidden">
  <div data-af-dim style="position:relative;z-index:1"><!-- hero content --></div>
</section>
<script type="module">
  import { createAsciiField } from './assets/js/ascii-field.js';
  const host = document.getElementById('hero');
  const start = () => createAsciiField({ host });
  'requestIdleCallback' in window ? requestIdleCallback(start) : setTimeout(start, 200);
</script>
```

Only touch the hero component, plus the one place that imports it. Don't restyle anything else on the site.

---

## 14. Testing

**Unit tests (vitest), with a fixed `seed`:**
- `vec2` maths; RNG determinism (same seed gives the same sequence).
- Sampler: a 3×1 sprite rotated by 90° stamps a vertical 1×3 line at the expected cells. Scale 2 doubles the footprint.
- `CellBuffer.stamp` respects depth and ignores out-of-bounds cells.
- Count formula (§7.3), including the clamps and the mobile factor.
- Scatter: the impulse points away from the click and falls off to 0 at `R`. Koi are unaffected.
- Feeding: a koi within 10 px of a pellet removes it. Pellets expire after 6 s.
- Switching: every exiting entity is gone within 0.8 s of simulated time.
- `destroy()`: the host is left with no `.af-*` nodes, and `requestAnimationFrame` is no longer scheduled. Mock rAF to check this.

**Demo page (`index.html`):**
- A full-screen host, a fake hero with a heading, a paragraph and a link (to test the ignore rules), and `data-af-dim` on the text block.
- With `?debug`, show the debug overlay.
- With `?stress`, mount and destroy the field 20 times in a row, then log the number of listeners and nodes left over.

**Manual checklist (record the results in `CHECKLIST.md`):**
- Each animal matches its description in §8.
- Click scatters every animal except koi, and koi feeding works.
- Clicking the link doesn't scatter.
- The switcher works with the keyboard.
- Tweaks apply live and survive a reload.
- Resizing works, including 320 px wide and 4K.
- Mobile emulation works with touch: tap feeds or scatters, and scrolling still works.
- Reduced motion shows a still frame.
- The FPS meter shows 0 work while the tab is hidden or the hero is scrolled away.

---

## 15. Milestones and acceptance criteria

| # | Milestone | Done when |
|---|---|---|
| **M1** | Scaffold, grid, background | Vite project runs; canvas fills the host and is sharp at DPR 2; the background field shimmers; resizing rebuilds without blur; ≤ 1 ms/frame |
| **M2** | Engine, butterflies, scatter | Loop, cell buffer, atlas, sampler and input in place; butterflies flap, wander and turn toward their direction of travel; click-scatter has falloff; clicking a link doesn't scatter; debug overlay works. **→ Stop here for review.** |
| **M3** | Koi | Procedural spine bodies with swimming wiggle; 5 variants; boids; soft edges; pellets, seeking, eating and ripples; koi never scatter |
| **M4** | Remaining 5 animals | Jellyfish, dragonfly (with trails), frog (jump state machine), crane (flocks, flapping), crab (sideways walking); each matches §8 |
| **M5** | UI, transitions, persistence | Switcher with keyboard support; Tweaks popover; hint; animals fly out and in on a switch; `af:v1` persistence |
| **M6** | Hardening | Reduced motion; pause when hidden or off-screen; mobile counts and cell size; dim mask; all unit tests pass; bundle ≤ 25 KB gzip; 60 fps at 1440p (from the debug overlay); stress test shows no leaks |
| **M7** | Integrate into portfolio | Stack detected; module copied; hero wrapped; Lighthouse performance score drops by no more than 3 points versus before; one commit with a clear message |

---

## 16. Definition of done
- [ ] All 7 animals work, and look and behave as described in §8.
- [ ] Scatter works for every animal except koi; feeding works for koi.
- [ ] Switcher, Tweaks and hint work with mouse, touch and keyboard.
- [ ] Animal and tweak choices persist across reloads.
- [ ] Reduced motion is respected; the loop pauses when hidden or off-screen.
- [ ] 60 fps at 1440p; bundle ≤ 25 KB gzip; zero runtime dependencies.
- [ ] `destroy()` leaves nothing behind.
- [ ] It's live on the portfolio hero, with the text readable, no layout shift and no new console errors.
