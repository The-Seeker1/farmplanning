import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(__dirname, '../../dist');
export const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };

export function serve(dir = DIST) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://x');
    let p = path.join(dir, decodeURIComponent(url.pathname));
    if (!p.startsWith(dir)) { response.writeHead(403); return response.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { response.writeHead(404); return response.end('not found'); }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export const SDA_FIXTURE = {
  Table: [
    ['mukey', 'muname', 'cokey', 'compname', 'comppct_r', 'drainagecl', 'slope_r', 'hydgrp', 'hzdept_r', 'hzdepb_r', 'ph1to1h2o_r', 'om_r', 'sandtotal_r', 'silttotal_r', 'claytotal_r', 'awc_r', 'resdept_r'],
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '100', 'Kennebec', '85', 'Moderately well drained', '1', 'B', '0', '20', '6.4', '3.0', '10', '68', '22', '0.22', null],
    ['1', 'Kennebec silt loam, 0 to 2 percent slopes', '100', 'Kennebec', '85', 'Moderately well drained', '1', 'B', '20', '41', '6.8', '2.0', '10', '60', '30', '0.20', null],
  ],
};

export async function launch({ mocks = true, log = [] } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(t)) problems.push(`console.${m.type()}: ${t}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const calls = [];
  if (mocks) {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const request = route.request();
      const u = new URL(request.url());
      calls.push(`${request.method()} ${u.host}${u.pathname}`);
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (u.host === 'nominatim.openstreetmap.org') return json([{ lat: '39.0473', lon: '-95.6752', display_name: 'Topeka, Shawnee County, Kansas, United States' }]);
      if (u.host === 'sdmdataaccess.sc.egov.usda.gov') return json(SDA_FIXTURE);
      if (u.host === 'rest.isric.org') return json({}, 500);
      if (u.host === 'generativelanguage.googleapis.com') {
        if (mocks.gemini) return mocks.gemini(route, request, u, json);
        return json({ error: { message: 'no mock' } }, 400);
      }
      if (/arcgisonline|openstreetmap.org|nationalmap/.test(u.host)) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
      return route.abort();
    });
  }
  return { browser, ctx: context, page, problems, calls, close: () => browser.close() };
}
