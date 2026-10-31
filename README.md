# Gisthall

An original, Nigerian-flavoured community discussion forum: sections and boards, threaded topics, quotes, likes and shares, follows, alerts, search and a full moderation toolkit.

Server-rendered HTML on **Express**, with all state stored in **SQLite** (Node's built-in `node:sqlite`). This includes members, sessions, posts, edit history, uploaded images (stored as BLOBs), notifications, reports and the moderation log. Nothing lives only in memory.

> The name, logo, design, code and demo content are original. All demo members and threads are fictional.

## Run it locally

Requires Node.js 22.5+ (for `node:sqlite`).

```bash
npm install
npm start
```

Open the address printed in the terminal, normally http://localhost:3000. If port 3000 is already taken by another app, Gisthall moves to 3001, 3002 and so on, and prints the port it used. To pick a port yourself: `PORT=4000 npm start`, or in PowerShell `$env:PORT=4000; npm start`.

On first start the database (`data/gisthall.db`) is created and seeded with demo content.

| Demo login | Username | Password |
| --- | --- | --- |
| Admin | `hallkeeper` | `Gisthall#2026` |
| Board mod (Tech Corner) | `bayo_builds` | `password123` |
| Board mod (Football) | `efe_waffi` | `password123` |
| Member | `amaka_writes` (and the other demo members) | `password123` |

Other commands:

```bash
npm run dev       # restart on file changes
npm run seed      # wipe data/gisthall.db and reload the demo content
npm test          # unit tests (node:test)
npm run test:e2e  # Playwright end-to-end browser tests
```

Environment variables: `PORT` (fixed port, fails clearly if busy), `START_PORT` (first port tried automatically, default 3000), `DB_PATH` (default `data/gisthall.db`), `FLOOD_SECONDS` (minimum gap between a member's posts, default 10), `SEED=0` (skip auto-seeding an empty DB), `SECURE_COOKIES=1` (behind HTTPS).

## Features

- **Front page** of moderator-featured topics, site stats, newest member, "Fresh gist" and the board directory
- **Sections → boards → child boards**, with topic counts, board moderators and per-board search
- **Topics**: paginated, with view counts, pinned, locked and hidden flags, and a follow button
- **Posts**: `[b]`, `[i]`, `[url]`, nested `[quote]`, auto-links, `@mentions`, up to 4 image attachments (validated by MIME type and file signature), signatures, edit with full history
- **Like and share** toggles (inline via JS, and they work without JS too) with counters and "likes received" on profiles
- **Members**: register and log in (scrypt hashes, DB sessions), profiles with topics and posts tabs, avatar upload, bio, location, gender, signature, password change (logs out every session)
- **Follow** members, boards and topics, with a "Following" feed
- **Alerts** for replies, quotes, mentions, likes, shares, new topics from people or boards you follow, new followers and hidden posts, plus an unread badge
- **Search** (SQLite FTS5) for topic titles or post text, optionally scoped to one board
- **Recent**, **Trending** (last 48 h) and **Who's online** (last 15 min)
- **Moderation**: report posts, a mod desk to hide, resolve or dismiss reports, and pin, lock, feature, move and hide topics. Board mods are scoped to their own boards. Bans with a reason and duration end the member's sessions. Every action is written to the moderation log.
- **Admin**: create sections and boards, assign or remove board moderators, change member roles
- CSRF protection on every form, HTML escaping everywhere, flood control, phone-friendly layout, automatic dark mode

## Project layout

```
src/server.js      entry point (opens DB, seeds if empty, starts HTTP)
src/app.js         Express app: middleware, CSRF, sessions, routes
src/db.js          schema + migrations (PRAGMA user_version)
src/lib/forum.js   all domain logic (used by routes and unit tests)
src/lib/format.js  post markup rendering, mentions, slugs, time formatting
src/views.js       server-rendered HTML templates
src/seed.js        fictional demo content
public/            CSS, small progressive-enhancement JS, logo
tests/unit/        node:test unit tests
e2e/               Playwright browser tests (incl. data surviving a server restart)
```
