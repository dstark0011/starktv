const ROOT = require('path').resolve(__dirname, '../..'); const OUT = ROOT + '/tests/out/';
const http = require('http'), fs = require('fs');
const xml = fs.readFileSync(ROOT + '/tests/perf/xmltv.xml');
http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/xml', 'Access-Control-Allow-Origin': '*' });
  for (let i = 0; i < xml.length; i += 65536) { res.write(xml.subarray(i, i + 65536)); await new Promise(r => setTimeout(r, 12)); }
  res.end();
}).listen(8765);
