const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { spawn } = require('child_process');

const PORT = 3457;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/send-to-cart') {
    try {
      const body = JSON.parse(await readBody(req));
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'no items' }));
      }

      const tmpFile = path.join(os.tmpdir(), `hazi-hinam-list-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(items), 'utf8');

      const child = spawn(
        process.execPath,
        [path.join(__dirname, 'automation', 'hazi-hinam', 'run-list.js'), '--file', tmpFile],
        { cwd: __dirname, detached: true, stdio: 'ignore' }
      );
      child.unref();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ started: true }));
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
