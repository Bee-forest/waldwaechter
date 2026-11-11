// Prüft die veröffentlichte App in Chrome und WebKit (iPhone): Karte, Kacheln, Antippen, Fehler.
const { chromium, webkit, devices } = require('playwright');
const URL = 'https://bee-forest.github.io/waldwaechter/';
(async () => {
  for (const [name, typ, geraet] of [['Chrome Android', chromium, devices['Pixel 7']], ['Safari iPhone', webkit, devices['iPhone 14']]]) {
    for (const basemap of ['osm', 'dop']) {
      const b = await typ.launch();
      const ctx = await b.newContext({ ...geraet });
      const p = await ctx.newPage();
      const fehler = [];
      p.on('pageerror', (e) => fehler.push(`PAGEERROR ${e.message} ${(e.stack || '').split('\n').slice(0, 3).join(' / ')}`));
      p.on('console', (m) => { if (m.type() === 'error') fehler.push(`CONSOLE ${m.text().slice(0, 200)}`); });
      p.on('requestfailed', (r) => fehler.push(`REQFAIL ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
      await p.addInitScript((bm) => { const s = JSON.parse(localStorage.getItem('waldwaechter.v1') || '{}'); s.tourDone = true; s.onboarded = true; s.onboardingDone = true; s.settings = { ...(s.settings || {}), basemap: bm }; localStorage.setItem('waldwaechter.v1', JSON.stringify(s)); }, basemap);
      try {
        await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
        await p.waitForTimeout(8000);
        const st = await p.evaluate(() => ({
          karten: document.querySelectorAll('.leaflet-container').length,
          kacheln: document.querySelectorAll('.leaflet-tile-loaded').length,
          kachelnGesamt: document.querySelectorAll('.leaflet-tile').length,
          groesse: (() => { const r = document.querySelector('.map-wrap .leaflet-container, #map')?.getBoundingClientRect(); return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'keine'; })(),
          version: document.querySelector('[data-version]')?.dataset.version || '',
        }));
        console.log(`\n=== ${name} · ${basemap}: ${JSON.stringify(st)}`);
        await p.screenshot({ path: `pruefung/${name.replace(/\W+/g, '_')}_${basemap}_1.png` });
        const box = await p.locator('.leaflet-container').first().boundingBox();
        if (box) {
          await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await p.waitForTimeout(7000);
          const info = await p.evaluate(() => (document.querySelector('#infobox')?.innerText || 'KEIN #infobox').slice(0, 250));
          const toasts = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '));
          console.log('Antippen:', info.replace(/\n/g, ' | '), '|| Toasts:', toasts);
          await p.screenshot({ path: `pruefung/${name.replace(/\W+/g, '_')}_${basemap}_2.png` });
        }
      } catch (e) { console.log(`=== ${name} · ${basemap}: ABBRUCH ${e.message}`); }
      console.log('Fehler:', fehler.length ? '\n  ' + [...new Set(fehler)].slice(0, 25).join('\n  ') : 'keine');
      await b.close();
    }
  }
})();
