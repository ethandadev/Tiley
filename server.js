#!/usr/bin/env node
/**
 * Tiley — numerical tilemap editor.
 * Entry point: boots the Express application and prints the local URL.
 */

import { createApp } from './src/backend/app.js';

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const app = await createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Tiley is running at http://${HOST}:${PORT}\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Start Tiley on another port, for example:\n\n    PORT=5173 npm start\n`);
    process.exit(1);
  }
  console.error('  Tiley failed to start:', error.message);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
