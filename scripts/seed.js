// Reset the database and load the demo content: `npm run seed`
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

const file = process.env.DB_PATH || 'data/gisthall.db';
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
const db = openDb(file);
const info = seed(db);
db.close();
console.log(`Seeded ${file}: ${info.users} members, ${info.topics} topics. Admin: ${info.admin.username} / ${info.admin.password}`);
