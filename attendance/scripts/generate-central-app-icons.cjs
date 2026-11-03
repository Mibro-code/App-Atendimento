// Render the repository-native vector icon into installation assets.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_RUNTIME || 'playwright');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/assets/central-favicon.svg'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const size of [192, 512]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
      await page.screenshot({ path: path.join(__dirname, `../public/assets/central-app-icon-${size}-v2.png`), omitBackground: true });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
