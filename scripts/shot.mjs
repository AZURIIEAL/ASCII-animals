// Visual QA screenshots (spec §15.1).
// node scripts/shot.mjs http://localhost:5173/ qa/koi "animal=koi&t=4" "animal=koi&t=6&seed=3"
import { chromium } from 'playwright';

const [url, out, ...queries] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1833, height: 987 } });
for (const [i, q] of queries.entries()) {
  await page.goto(`${url}?${q}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}_${i}.png` });
}
await browser.close();
