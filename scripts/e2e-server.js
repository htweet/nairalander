// Starts a fresh, seeded server for the Playwright suite.
import fs from 'node:fs';

const file = process.env.DB_PATH;
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
await import('../src/server.js');
