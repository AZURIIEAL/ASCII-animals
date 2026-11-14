// Dev aid: render one entity into the cell buffer and print it as text (alpha-coded).
// npx vite-node scripts/ascii-dump.ts <animal> [heading] [scale]
import { CellBuffer } from '../src/engine/cellBuffer';
import { Trails } from '../src/engine/trails';
import { makeGrid } from '../src/engine/grid';
import { PaletteTable } from '../src/engine/palettes';
import { World } from '../src/engine/world';
import { ANIMALS, registerPalettes } from '../src/animals/registry';
import { mulberry32 } from '../src/math/rng';

const [id = 'crane', hArg = '-1.5708', sArg = '1'] = process.argv.slice(2);
registerPalettes(new PaletteTable());
const def = ANIMALS.find((a) => a.id === id)!;
const buf = new CellBuffer();
const trails = new Trails();
const g = makeGrid(360, 360, 9, 1);
buf.resize(g.cols, g.rows);
trails.resize(g.cols, g.rows);
const w = new World(def, mulberry32(1), buf, trails, 1);
w.countOverride = 1;
w.setGrid(g);
w.syncCount();
const e = w.entities[0];
Object.assign(e, { x: 180, y: 180, heading: +hArg, drawHeading: +hArg, scale: +sArg, panic: 0 });
w.render();
const ramp = ' .:-=+*#%@';
for (let r = 0; r < g.rows; r++) {
  let line = '';
  for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c;
    if (buf.frame[i] !== (buf as unknown as { frameNo: number }).frameNo || buf.alpha[i] < 0.15) {
      line += ' ';
      continue;
    }
    const key = buf.key[i];
    const tile = ((key >> 6) & 1) === 0;
    // Tiles: shade step 0–23 as a brightness glyph; glyph-only cells: '~'.
    line += tile ? ramp[Math.min(9, Math.round(((key & 63) / 23) * 9))] : '~';
  }
  if (line.trim()) console.log(line);
}
