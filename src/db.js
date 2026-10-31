// Database layer: SQLite via Node's built-in node:sqlite. Every piece of forum
// state (users, sessions, posts, uploads, notifications, moderation) lives here.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1: core schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','mod','admin')),
    bio TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    avatar_id INTEGER,
    post_count INTEGER NOT NULL DEFAULT 0,
    topic_count INTEGER NOT NULL DEFAULT 0,
    likes_received INTEGER NOT NULL DEFAULT 0,
    banned_until TEXT,
    ban_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE boards (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES boards(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    topic_count INTEGER NOT NULL DEFAULT 0,
    post_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE board_mods (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (board_id, user_id)
  );
  CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_post_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_post_user_id INTEGER REFERENCES users(id),
    views INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    sticky INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    featured_at TEXT
  );
  CREATE INDEX topics_board ON topics(board_id, sticky DESC, last_post_at DESC);
  CREATE INDEX topics_recent ON topics(last_post_at DESC);
  CREATE INDEX topics_featured ON topics(featured_at DESC);
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT,
    edit_count INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    like_count INTEGER NOT NULL DEFAULT 0,
    share_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX posts_topic ON posts(topic_id, id);
  CREATE INDEX posts_user ON posts(user_id, id DESC);
  CREATE TABLE post_edits (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    editor_id INTEGER NOT NULL REFERENCES users(id),
    old_body TEXT NOT NULL,
    edited_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('post','avatar')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX attachments_post ON attachments(post_id);
  CREATE TABLE likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE shares (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, followee_id)
  );
  CREATE TABLE topic_follows (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, topic_id)
  );
  CREATE TABLE board_follows (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, board_id)
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, id DESC);
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE mod_log (
    id INTEGER PRIMARY KEY,
    mod_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE VIRTUAL TABLE topics_fts USING fts5(title, content='topics', content_rowid='id');
  CREATE TRIGGER topics_ai AFTER INSERT ON topics BEGIN
    INSERT INTO topics_fts(rowid, title) VALUES (new.id, new.title);
  END;
  CREATE TRIGGER topics_ad AFTER DELETE ON topics BEGIN
    INSERT INTO topics_fts(topics_fts, rowid, title) VALUES ('delete', old.id, old.title);
  END;
  CREATE TRIGGER topics_au AFTER UPDATE OF title ON topics BEGIN
    INSERT INTO topics_fts(topics_fts, rowid, title) VALUES ('delete', old.id, old.title);
    INSERT INTO topics_fts(rowid, title) VALUES (new.id, new.title);
  END;
  CREATE VIRTUAL TABLE posts_fts USING fts5(body, content='posts', content_rowid='id');
  CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
  END;
  CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, body) VALUES ('delete', old.id, old.body);
  END;
  CREATE TRIGGER posts_au AFTER UPDATE OF body ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, body) VALUES ('delete', old.id, old.body);
    INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
  END;
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Run fn inside a transaction (nested calls join the outer one). */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
