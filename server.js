const http = require('http');
const fs = require('fs');
const path = require('path');
http.createServer((req,res)=>{const file=path.join(__dirname,req.url==='/'?'index.html':req.url);fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)})}).listen(4173,'127.0.0.1');
