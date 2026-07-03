const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { spawn } = require('child_process');

const PORT = 3457;
const RESULTS_MARKER = 'RESULTS_JSON:';

// A single unhandled error anywhere (e.g. from a spawned child) must not take
// the whole server down — log it and keep serving.
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Runs run-list.js for the given items. Resolves as soon as the add-to-cart
// phase reports its results (fast), while the child keeps running in the
// background afterwards to open the review browser — the caller doesn't wait
// for that part, since the user may leave it open indefinitely.
function runList(items) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `hazi-hinam-list-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(items), 'utf8');

    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'automation', 'hazi-hinam', 'run-list.js'), '--file', tmpFile],
      { cwd: __dirname, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let settled = false;
    let buffer = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!settled && line.startsWith(RESULTS_MARKER)) {
          settled = true;
          try {
            resolve(JSON.parse(line.slice(RESULTS_MARKER.length)));
          } catch (e) {
            reject(e);
          }
          child.unref();
        }
      }
    });

    child.stderr.on('data', () => {}); // drain so the child never blocks on a full pipe

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`automation exited before reporting results (code ${code})`));
      }
    });
  });
}

// Runs check-prices.js for the given items (read-only price lookup, no cart
// changes, no browser). Waits for the whole child to finish since it's a
// short-lived, one-shot process — unlike runList there's no browser step
// left running in the background afterwards.
function checkPrices(items) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `hazi-hinam-prices-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(items), 'utf8');

    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'automation', 'hazi-hinam', 'check-prices.js'), '--file', tmpFile],
      { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let settled = false;
    let buffer = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!settled && line.startsWith(RESULTS_MARKER)) {
          settled = true;
          try {
            resolve(JSON.parse(line.slice(RESULTS_MARKER.length)));
          } catch (e) {
            reject(e);
          }
        }
      }
    });

    child.stderr.on('data', () => {}); // drain so the child never blocks on a full pipe

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`price check exited before reporting results (code ${code})`));
      }
    });
  });
}

http.createServer(async (req, res) => {
  // CORS: index.html is often opened directly as a file:// page, which makes
  // these API calls cross-origin from the browser's point of view.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/check-prices') {
    try {
      const body = JSON.parse(await readBody(req));
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'no items' }));
      }

      const { results } = await checkPrices(items);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/send-to-cart') {
    try {
      const body = JSON.parse(await readBody(req));
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'no items' }));
      }

      const results = await runList(items);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
