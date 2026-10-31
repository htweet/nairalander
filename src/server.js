import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const PORT_FIXED = Boolean(process.env.PORT);
const PORT = Number(process.env.PORT || process.env.START_PORT || 3000);
const MAX_PORT_TRIES = 10;
const DB_PATH = process.env.DB_PATH || 'data/gisthall.db';

const db = openDb(DB_PATH);
if (process.env.SEED !== '0' && !db.prepare('SELECT 1 FROM sections LIMIT 1').get()) {
  const info = seed(db);
  console.log(`Seeded demo data (${info.users} members, ${info.topics} topics). Admin login: ${info.admin.username} / ${info.admin.password}`);
}

const app = createApp(db, {
  floodSeconds: Number(process.env.FLOOD_SECONDS ?? 10),
  secureCookies: process.env.SECURE_COOKIES === '1',
});

let server;

// Without an explicit PORT, step to the next port when one is taken
// (e.g. another dev server already on 3000). With PORT set, fail clearly.
function listen(port, triesLeft) {
  server = app.listen(port, () => console.log(`Gisthall running at http://localhost:${port} (db: ${DB_PATH})`));
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (!PORT_FIXED && triesLeft > 0) {
      console.log(`Port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error(
      PORT_FIXED
        ? `Port ${port} is already in use. Pick another one, e.g. PORT=${port + 1} (PowerShell: $env:PORT=${port + 1}; npm start).`
        : `Ports ${PORT}–${port} are all in use. Set PORT to a free port and try again.`,
    );
    db.close();
    process.exit(1);
  });
}
listen(PORT, MAX_PORT_TRIES);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
