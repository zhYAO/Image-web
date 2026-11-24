'use strict';

const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const https = require('node:https');

const hostname = 'www.zimage.store';
const fixedPaths = new Set(['/api/health/ready', '/version.json', '/api/meta', '/api/public-config', '/']);
const asset = /^\/frontend-assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const maxBytes = 8_000_000;

async function fetchBody(path) {
  if (typeof path !== 'string' || path.length > 4096 ||
      !(fixedPaths.has(path) || (asset.test(path) && !path.split('/').some(p => p === '.' || p === '..')))) {
    throw new Error('Invalid public probe path');
  }

  // Normal public DNS, system trust store, default hostname verification, no redirect handler.
  const request = https.get({
    hostname, servername: hostname, port: 443, path, agent: false, rejectUnauthorized: true,
    ca: readFileSync('/etc/ssl/certs/ca-certificates.crt'),
    headers: { 'Cache-Control': 'no-cache' },
  });
  try {
    const [response] = await once(request, 'response');
    if (response.statusCode !== 200) throw new Error('Unexpected HTTP status ' + response.statusCode);
    const mime = (response.headers['content-type'] || '').toLowerCase().split(';')[0];
    if (path.endsWith('.js') && !['application/javascript', 'text/javascript'].includes(mime)) {
      throw new Error('Unexpected script MIME type');
    }
    if (Number(response.headers['content-length']) > maxBytes) throw new Error('Response too large');
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Response too large');
      chunks.push(chunk);
    }
    if (!response.complete) throw new Error('Incomplete response');
    return Buffer.concat(chunks, size);
  } finally {
    request.destroy();
  }
}

fetchBody(process.argv[2]).then(body => process.stdout.write(body)).catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
