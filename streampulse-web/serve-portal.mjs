import { createServer } from 'vite';

const server = await createServer({
  configFile: './vite.config.ts',
  root: 'C:/Users/Aron/streamclone-pulse/streampulse-web',
  server: {
    port: 5173,
    host: '0.0.0.0',
  }
});

await server.listen();
server.printUrls();

// Keep event loop alive indefinitely
setInterval(() => {}, 1000 * 60 * 60);
