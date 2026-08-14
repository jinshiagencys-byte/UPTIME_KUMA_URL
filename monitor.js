const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET = process.env.TARGET_URL || process.argv[2] || 'https://adorable-bonbon-d2a467.netlify.app/';
const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL; // optional
const MAX_RETRIES = parseInt(process.env.RETRIES || '2', 10);
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT || '30000', 10);
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'artifacts', 'screenshots');
const HTML_DIR = path.resolve(process.cwd(), 'artifacts', 'html');
// ACTIONS: JSON-encoded array of actions, ex:
// [{"type":"click","selector":"a.login"},{"type":"wait","ms":1000},{"type":"fill","selector":"input[name=q]","value":"pizza"}]
const ACTIONS_RAW = process.env.ACTIONS || null;
let ACTIONS = null;
try { ACTIONS = ACTIONS_RAW ? JSON.parse(ACTIONS_RAW) : null; } catch (e) { ACTIONS = null; console.warn('Invalid ACTIONS JSON, ignoring'); }

// Default actions tailored to this project's `index.html` buttons when no ACTIONS provided.
if (!ACTIONS) {
  ACTIONS = [
    { type: 'click', selector: 'button.search-btn', expectSelector: 'div.search-container', critical: true },
    { type: 'wait', ms: 400 },
    { type: 'fill', selector: 'input.search-input', value: 'burger', critical: true },
    { type: 'click', selector: 'button.search-submit', critical: true },
    { type: 'wait', ms: 1000 },
    { type: 'click', selector: 'button.search-close-btn', critical: false }, // ok if not present
    { type: 'wait', ms: 300 },
    { type: 'click', selector: 'section.hero .btn', expectSelector: 'section.hero', critical: true }, // Book A Table
    { type: 'wait', ms: 800 },
    { type: 'click', selector: 'a.btn.food-menu-btn', expectSelector: '.food-menu-list', critical: true }, // first Order Now
    { type: 'wait', ms: 800 },
    { type: 'click', selector: 'a[href="/reservation"]', critical: true }, // Reservation link
    { type: 'wait', ms: 800 },
    { type: 'click', selector: 'ul.fiter-list button.filter-btn', expectSelector: '.fiter-list', critical: true }, // apply first filter
  ];
}

function randBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function performActions(page, actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return;
  for (const a of actions) {
    const type = (a.type || 'click').toLowerCase();
    const sel = a.selector;
    const delay = a.delayMs || randBetween(300, 1200);
    const isCritical = a.critical !== false; // default to critical
    
    try {
      if (type === 'wait') {
        await page.waitForTimeout(a.ms || 1000);
      } else if (type === 'fill') {
        if (!sel) continue;
        await page.fill(sel, a.value || '', { timeout: 5000 });
        await page.waitForTimeout(delay);
      } else if (type === 'click') {
        if (!sel) continue;
        // Try normal click first
        try {
          const navPromise = page.waitForNavigation({ waitUntil: 'networkidle', timeout: NAV_TIMEOUT }).catch(() => null);
          await page.click(sel, { timeout: 5000 });
          await navPromise;
        } catch (clickErr) {
          // Fallback: scroll into view + click via JS
          await page.$eval(sel, el => el.scrollIntoView());
          await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, sel);
        }
        await page.waitForTimeout(delay);
      }
      
      // Verify expected selector appears after action (if specified)
      if (a.expectSelector) {
        const expectTimeout = a.expectTimeout || 5000;
        await page.waitForSelector(a.expectSelector, { timeout: expectTimeout });
        console.log(`✓ Action verified: ${type} ${sel} → ${a.expectSelector} found`);
      }
    } catch (err) {
      const msg = `Action ${isCritical ? 'CRITICAL' : 'non-critical'} failed (${type} ${sel}): ${err && err.message}`;
      if (isCritical) {
        throw new Error(msg);
      } else {
        console.warn(msg);
      }
    }
  }
}

function ensureDirs() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(HTML_DIR, { recursive: true });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sendPing(pingUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    if (!pingUrl) return resolve({ status: 'no-url' });
    try {
      const u = new URL(pingUrl);
      const opts = {
        method: 'GET',
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        headers,
        timeout: 5000
      };
      const req = https.request(opts, res => {
        // consume body
        res.on('data', () => {});
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function run() {
  ensureDirs();

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoles = [];
  page.on('console', msg => consoles.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => consoles.push({ type: 'pageerror', text: String(err) }));

  let success = false;
  let lastError = null;

  for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES + 1); attempt++) {
    try {
      console.log(`Attempt ${attempt} — navigating to ${TARGET}`);
      const resp = await page.goto(TARGET, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

      if (resp && resp.status() >= 500) {
        throw new Error(`Server error, status ${resp.status()}`);
      }

      // If actions provided, perform them (clicks/fills/waits) to simulate human behavior
      // Errors from critical actions will propagate and fail the test
      await performActions(page, ACTIONS);

      // Flexible success checks: at least one of these selectors should appear
      const checks = ['h1', 'main', 'header', 'body'];
      let found = false;
      for (const sel of checks) {
        try {
          await page.waitForSelector(sel, { timeout: 8000 });
          found = true;
          break;
        } catch (e) {
          // continue
        }
      }

      if (!found) {
        // as a fallback, check for non-empty page content
        const html = await page.content();
        if (!html || html.trim().length < 100) {
          throw new Error('Page content appears empty or no expected selectors found');
        }
      }

      success = true;
      console.log('✅ Page checks OK');
      break;
    } catch (err) {
      lastError = err;
      console.error(`❌ Attempt ${attempt} failed: ${err.message}`);

      // capture artifacts
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const shotPath = path.join(SCREENSHOT_DIR, `failed-${ts}-attempt${attempt}.png`);
      const htmlPath = path.join(HTML_DIR, `failed-${ts}-attempt${attempt}.html`);
      try { await page.screenshot({ path: shotPath, fullPage: true }); console.log('Saved screenshot', shotPath); } catch(e){console.warn('Screenshot failed', e.message);} 
      try { fs.writeFileSync(htmlPath, await page.content(), 'utf8'); console.log('Saved HTML', htmlPath); } catch(e){console.warn('Save HTML failed', e.message);} 
      console.log('Recent console messages:', consoles.slice(-10));

      if (attempt <= MAX_RETRIES) {
        const backoff = 1000 * attempt;
        console.log(`Retrying after ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
    }
  }

  try {
    if (success) {
      if (UPTIME_KUMA_URL) {
        try {
          const pingRes = await sendPing(UPTIME_KUMA_URL, { 'Bypass-Tunnel-Reminder': 'true' });
          console.log('📡 Uptime Kuma ping result:', pingRes);
        } catch (err) {
          console.warn('Ping to Uptime Kuma failed:', err.message);
        }
      } else {
        console.log('No UPTIME_KUMA_URL provided — skipping ping.');
      }
      await browser.close();
      process.exit(0);
    } else {
      console.error('All attempts failed. Last error:', lastError && lastError.message);
      // Do NOT ping Uptime Kuma on failure
      await browser.close();
      process.exit(1);
    }
  } catch (finalErr) {
    console.error('Unexpected error during shutdown:', finalErr.message);
    try { await browser.close(); } catch(e){}
    process.exit(1);
  }
}

// Run
run().catch(err => {
  console.error('Fatal error:', err && err.message);
  process.exit(1);
});
