const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3457;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
