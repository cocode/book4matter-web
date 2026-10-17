import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
  '--port', '5173', '--strictPort', '--configLoader', 'native',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', data => { output += data; });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (server.exitCode !== null) break;
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok && (await response.text()).includes('Book4matter')) {
        ready = true;
        break;
      }
    } catch { /* Wait for the server to bind. */ }
  }
  assert.ok(ready, output || 'Development server did not respond');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.doesNotMatch(output, /EACCES|error when|Error:/);
  console.log('PASS: unprivileged development server HTTP response');
} finally {
  server.kill('SIGTERM');
}
