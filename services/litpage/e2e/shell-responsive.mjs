// Shell responsive: docked sidebar at 1440/1024/768 (docked at each width), drawer on phones (390).
import { mkdirSync } from 'node:fs';
import { launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/responsive';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
try {
  await signup(page);
  await page.click('text=Welcome to Litpage');
  await page.waitForTimeout(800);
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const nav = await page.locator('nav.lit-sidebar-container').boundingBox();
    const frame = await page.locator('main.lit-frame').boundingBox();
    console.log(w, 'nav', JSON.stringify(nav), 'frame', JSON.stringify(frame));
    if (w >= 600) ok(Math.round(nav.width) === 270 && Math.round(frame.x) === 270, `${w}px: sidebar docked 270`);
    else ok(Math.round(nav.width) === 0 && Math.round(frame.x) === 0, `${w}px: sidebar collapsed to a drawer`);
    await page.screenshot({ path: `${OUT}/r-${w}.png` });
  }
  // open the drawer on the phone layout
  await page.click('.lit-topbar .nc-topbar-sidebar-btn'); // "Keep the sidebar open"
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/r-390-drawer.png` });
  const drawer = await page.locator('.lit-sidebar').boundingBox();
  ok(drawer && drawer.x >= 0 && drawer.width > 200, `390px: drawer visible (${JSON.stringify(drawer)})`);
  await page.click('.nc-sb-mobile-backdrop', { position: { x: 370, y: 400 } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/r-390-closed.png` });
} catch (e) {
  console.log('E2E FAILED', e.message.slice(0, 500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
