import { spawn } from 'node:child_process';
import fs from 'node:fs';

const log = fs.openSync('C:/Users/Aron/vite.log', 'w');
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--host', '0.0.0.0'], {
  cwd: 'C:/Users/Aron/streamclone-pulse/streampulse-web',
  stdio: ['pipe', log, log],
  detached: true
});

child.unref();
console.log('Spawned with PID:', child.pid);
