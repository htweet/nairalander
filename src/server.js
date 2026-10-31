import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const PORT = Number(process.env.PORT || 3000);
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

const server = app.listen(PORT, () => console.log(`Gisthall running at http://localhost:${PORT} (db: ${DB_PATH})`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
