import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForum, ForumError, MAX_IMAGE_BYTES } from './lib/forum.js';
import { randomToken, safeEqual } from './lib/security.js';
import { stripQuotes } from './lib/format.js';
import * as V from './views.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'gh_session';
const ANON_CSRF_COOKIE = 'gh_csrf';
const FLASH_COOKIE = 'gh_flash';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const pageNum = (v) => Math.max(1, parseInt(v, 10) || 1);
const safeNext = (n, fallback = '/') => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : fallback);

export function createApp(db, { floodSeconds = 0, secureCookies = false } = {}) {
  const forum = createForum(db, { floodSeconds });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 4 },
  });

  const cookie = (res, name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  };

  app.use('/static', express.static(path.join(ROOT, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));

  // Session + view context.
  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    const session = forum.getSession(req.cookies[SESSION_COOKIE]);
    if (session) {
      if (forum.isBanned(session)) {
        forum.destroySession(session.token);
      } else {
        req.user = session;
        forum.touch(session.id);
      }
    }
    let csrf = req.user?.csrf;
    if (!csrf) {
      csrf = req.cookies[ANON_CSRF_COOKIE];
      if (!csrf) {
        csrf = randomToken(18);
        cookie(res, ANON_CSRF_COOKIE, csrf);
      }
    }
    let flash = null;
    if (req.cookies[FLASH_COOKIE]) {
      try {
        flash = JSON.parse(req.cookies[FLASH_COOKIE]);
      } catch {
        /* ignore malformed flash */
      }
      // Consume the flash only when an HTML page actually shows it, so it
      // survives intermediate redirects (e.g. /p/:id -> topic page).
      const send = res.send.bind(res);
      res.send = (body) => {
        const type = res.get('Content-Type');
        if (!type || type.includes('html')) cookie(res, FLASH_COOKIE, '', { maxAge: 0 });
        return send(body);
      };
    }
    req.ctx = { user: req.user, csrf, flash, unread: req.user ? forum.unreadCount(req.user.id) : 0, q: '' };
    res.flash = (type, text) => cookie(res, FLASH_COOKIE, JSON.stringify({ type, text }));
    next();
  });

  const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

  function checkCsrf(req, _res, next) {
    const sent = req.body?._csrf || req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.ctx.csrf)) return next(new ForumError(403, 'Your session expired. Reload the page and try again.'));
    next();
  }

  function requireUser(req, res, next) {
    if (req.user) return next();
    if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    next(new ForumError(401, 'Please log in first.'));
  }

  const h = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };

  const post = (route, ...handlers) => app.post(route, ...handlers.slice(0, -1), checkCsrf, h(handlers[handlers.length - 1]));
  const multipart = upload.array('images', 4);

  // ---------- public pages ----------
  app.get('/', h((req, res) => {
    res.send(
      V.homePage(req.ctx, {
        stats: forum.stats(),
        sections: forum.directory(),
        featured: forum.frontPage(),
        recent: forum.recentTopics(1).topics.slice(0, 15),
      }),
    );
  }));

  app.get('/boards', h((req, res) => res.send(V.boardsPage(req.ctx, forum.directory()))));
  app.get('/rules', h((req, res) => res.send(V.rulesPage(req.ctx))));

  app.get('/recent', h((req, res) => {
    const page = pageNum(req.query.page);
    res.send(V.listingPage(req.ctx, { title: 'Recent topics', hint: 'Topics with the newest replies.', list: forum.recentTopics(page), page, base: '/recent' }));
  }));

  app.get('/trending', h((req, res) => {
    res.send(V.listingPage(req.ctx, { title: 'Trending', hint: 'Most active topics in the last 48 hours.', list: { topics: forum.trendingTopics() }, page: 1, base: '/trending' }));
  }));

  app.get('/online', h((req, res) => res.send(V.onlinePage(req.ctx, { users: forum.onlineUsers() }))));

  app.get('/search', h((req, res) => {
    const q = String(req.query.q || '').slice(0, 200);
    const type = req.query.type === 'posts' ? 'posts' : 'topics';
    const board = String(req.query.board || '');
    req.ctx.q = q;
    const results = q ? forum.search(q, { type, boardSlug: board }) : [];
    res.send(V.searchPage(req.ctx, { q, type, board, results, boards: forum.allBoards() }));
  }));

  app.get('/media/:id', h((req, res) => {
    const a = forum.getAttachment(Number(req.params.id));
    if (!a) throw new ForumError(404, 'File not found.');
    res.set({ 'Content-Type': a.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(a.data));
  }));

  // ---------- auth ----------
  app.get('/register', h((req, res) => (req.user ? res.redirect('/') : res.send(V.authPage(req.ctx, { mode: 'register', next: req.query.next })))));
  app.get('/login', h((req, res) => (req.user ? res.redirect('/') : res.send(V.authPage(req.ctx, { mode: 'login', next: req.query.next })))));

  function startSession(res, userId) {
    const { token } = forum.createSession(userId);
    cookie(res, SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 30 });
  }

  post('/register', (req, res) => {
    try {
      const user = forum.register(req.body);
      startSession(res, user.id);
      res.flash('ok', `Welcome to ${V.SITE}, ${user.username}!`);
      res.redirect(safeNext(req.body.next));
    } catch (err) {
      if (!(err instanceof ForumError)) throw err;
      req.ctx.flash = { type: 'error', text: err.message };
      res.status(err.status).send(V.authPage(req.ctx, { mode: 'register', values: req.body, next: req.body.next }));
    }
  });

  post('/login', (req, res) => {
    try {
      const user = forum.authenticate(req.body.login, req.body.password);
      if (forum.isBanned(user)) throw new ForumError(403, `This account is banned until ${user.banned_until} UTC. Reason: ${user.ban_reason || '—'}`);
      startSession(res, user.id);
      res.redirect(safeNext(req.body.next));
    } catch (err) {
      if (!(err instanceof ForumError)) throw err;
      req.ctx.flash = { type: 'error', text: err.message };
      res.status(err.status).send(V.authPage(req.ctx, { mode: 'login', values: req.body, next: req.body.next }));
    }
  });

  post('/logout', (req, res) => {
    if (req.user) forum.destroySession(req.user.token);
    cookie(res, SESSION_COOKIE, '', { maxAge: 0 });
    res.redirect('/');
  });

  // ---------- boards & topics ----------
  app.get('/b/:slug', h((req, res) => {
    const board = forum.getBoard(req.params.slug);
    const page = pageNum(req.query.page);
    const isMod = forum.canModerate(req.user, board.id);
    res.send(
      V.boardPage(req.ctx, {
        board,
        page,
        isMod,
        list: forum.boardTopics(board.id, page, { includeHidden: isMod }),
        following: req.user ? forum.isFollowingBoard(req.user.id, board.id) : false,
      }),
    );
  }));

  post('/b/:slug/follow', requireUser, (req, res) => {
    const on = forum.toggleFollowBoard(req.user, req.params.slug);
    res.flash('ok', on ? 'You will be alerted about new topics in this board.' : 'Board unfollowed.');
    res.redirect(`/b/${req.params.slug}`);
  });

  app.get('/b/:slug/new', requireUser, h((req, res) => res.send(V.newTopicPage(req.ctx, { board: forum.getBoard(req.params.slug) }))));

  post('/b/:slug/new', requireUser, multipart, (req, res) => {
    try {
      const { topicId, slug } = forum.createTopic(req.user, req.params.slug, req.body, req.files || []);
      res.redirect(`/t/${topicId}/${slug}`);
    } catch (err) {
      if (!(err instanceof ForumError) || err.status >= 500 || err.status === 404) throw err;
      req.ctx.flash = { type: 'error', text: err.message };
      res.status(err.status).send(V.newTopicPage(req.ctx, { board: forum.getBoard(req.params.slug), values: req.body }));
    }
  });

  function renderTopic(req, res, { quoteText = '' } = {}) {
    const id = Number(req.params.id);
    const probe = forum.getTopic(id, { includeHidden: true });
    const canMod = forum.canModerate(req.user, probe.board_id);
    if (probe.hidden && !canMod) throw new ForumError(404, 'Topic not found.');
    let page = pageNum(req.query.page);
    if (req.method === 'GET' && !req.query.quote) forum.addView(id);
    const topic = forum.getTopic(id, { includeHidden: true });
    if (req.query.quote) {
      const quoted = forum.getPost(Number(req.query.quote));
      if (quoted.topic_id === id && !quoted.hidden) {
        quoteText = `[quote author=${quoted.username} post=${quoted.id}]${stripQuotes(quoted.body).trim()}[/quote]\n`;
      }
    }
    let list = forum.topicPosts(id, page, req.user?.id);
    if (page > list.pages) {
      page = list.pages;
      list = forum.topicPosts(id, page, req.user?.id);
    }
    res.send(
      V.topicPage(req.ctx, {
        topic,
        list,
        page,
        canMod,
        quoteText,
        boards: canMod ? forum.allBoards() : [],
        following: req.user ? forum.isFollowingTopic(req.user.id, id) : false,
      }),
    );
  }

  app.get('/t/:id', h((req, res) => {
    const t = forum.getTopic(Number(req.params.id), { includeHidden: true });
    res.redirect(301, `/t/${t.id}/${t.slug}`);
  }));
  app.get('/t/:id/:slug', h((req, res) => renderTopic(req, res)));

  post('/t/:id/reply', requireUser, multipart, (req, res) => {
    try {
      const postId = forum.reply(req.user, Number(req.params.id), req.body.body, req.files || []);
      res.redirect(`/p/${postId}`);
    } catch (err) {
      if (!(err instanceof ForumError) || err.status === 404) throw err;
      req.ctx.flash = { type: 'error', text: err.message };
      res.status(err.status);
      req.query = { page: '99999' };
      renderTopic(req, res, { quoteText: req.body.body });
    }
  });

  post('/t/:id/follow', requireUser, (req, res) => {
    const id = Number(req.params.id);
    const on = forum.toggleFollowTopic(req.user, id);
    const t = forum.getTopic(id);
    res.flash('ok', on ? 'You will be alerted about new replies.' : 'Topic unfollowed.');
    res.redirect(`/t/${id}/${t.slug}`);
  });

  post('/t/:id/mod', requireUser, (req, res) => {
    const id = Number(req.params.id);
    forum.setTopicFlag(req.user, id, req.body.flag, req.body.value === '1');
    const t = forum.getTopic(id, { includeHidden: true });
    res.flash('ok', 'Topic updated.');
    res.redirect(`/t/${id}/${t.slug}`);
  });

  post('/t/:id/move', requireUser, (req, res) => {
    const id = Number(req.params.id);
    forum.moveTopic(req.user, id, req.body.board);
    const t = forum.getTopic(id, { includeHidden: true });
    res.flash('ok', `Topic moved to ${t.board_name}.`);
    res.redirect(`/t/${id}/${t.slug}`);
  });

  // ---------- posts ----------
  app.get('/p/:id', h((req, res) => {
    const p = forum.getPost(Number(req.params.id));
    const page = forum.postPage(p);
    res.redirect(`/t/${p.topic_id}/${p.topic_slug}${page > 1 ? `?page=${page}` : ''}#p${p.id}`);
  }));

  function firstPostId(topicId) {
    return db.prepare('SELECT MIN(id) AS id FROM posts WHERE topic_id = ?').get(topicId).id;
  }

  app.get('/p/:id/edit', requireUser, h((req, res) => {
    const p = forum.getPost(Number(req.params.id));
    if (p.user_id !== req.user.id && !forum.canModerate(req.user, p.board_id)) throw new ForumError(403, 'You can only edit your own posts.');
    res.send(V.editPostPage(req.ctx, { post: p, isFirst: firstPostId(p.topic_id) === p.id }));
  }));

  post('/p/:id/edit', requireUser, (req, res) => {
    const p = forum.editPost(req.user, Number(req.params.id), req.body.body, req.body.title);
    res.flash('ok', 'Post updated.');
    res.redirect(`/p/${p.id}`);
  });

  app.get('/p/:id/history', h((req, res) => {
    const p = forum.getPost(Number(req.params.id));
    if ((p.hidden || p.topic_hidden) && !forum.canModerate(req.user, p.board_id)) throw new ForumError(404, 'Post not found.');
    res.send(V.historyPage(req.ctx, { post: p, edits: forum.postEdits(p.id) }));
  }));

  for (const action of ['like', 'share']) {
    post(`/p/:id/${action}`, requireUser, (req, res) => {
      const id = Number(req.params.id);
      const result = action === 'like' ? forum.toggleLike(req.user, id) : forum.toggleShare(req.user, id);
      if (wantsJson(req)) return res.json(result);
      res.redirect(`/p/${id}`);
    });
  }

  app.get('/p/:id/likes', h((req, res) => res.json(forum.postLikers(Number(req.params.id)))));

  app.get('/p/:id/report', requireUser, h((req, res) => res.send(V.reportPage(req.ctx, { post: forum.getPost(Number(req.params.id)) }))));

  post('/p/:id/report', requireUser, (req, res) => {
    const id = Number(req.params.id);
    forum.report(req.user, id, req.body.reason);
    res.flash('ok', 'Thanks. The moderators have been told.');
    res.redirect(`/p/${id}`);
  });

  for (const action of ['hide', 'unhide']) {
    post(`/p/:id/${action}`, requireUser, (req, res) => {
      const id = Number(req.params.id);
      forum.setPostHidden(req.user, id, action === 'hide');
      res.flash('ok', action === 'hide' ? 'Post hidden.' : 'Post restored.');
      res.redirect(safeNext(req.body.next, `/p/${id}`));
    });
  }

  // ---------- members ----------
  app.get('/u/:name', h((req, res) => {
    const user = forum.profile(req.params.name);
    const tab = req.query.tab === 'posts' ? 'posts' : 'topics';
    res.send(
      V.profilePage(req.ctx, {
        user,
        tab,
        topics: tab === 'topics' ? forum.userTopics(user.id) : [],
        posts: tab === 'posts' ? forum.userPosts(user.id, req.user?.id) : [],
        isMe: req.user?.id === user.id,
        isFollowing: req.user ? forum.isFollowingUser(req.user.id, user.id) : false,
        banned: forum.isBanned(user),
      }),
    );
  }));

  app.get('/u/:name/followers', h((req, res) => {
    const user = forum.profile(req.params.name);
    res.send(V.peoplePage(req.ctx, { user, kind: 'followers', people: forum.followers(user.id) }));
  }));
  app.get('/u/:name/following', h((req, res) => {
    const user = forum.profile(req.params.name);
    res.send(V.peoplePage(req.ctx, { user, kind: 'following', people: forum.following(user.id) }));
  }));

  post('/u/:name/follow', requireUser, (req, res) => {
    const on = forum.toggleFollowUser(req.user, req.params.name);
    res.flash('ok', on ? `You are now following ${req.params.name}.` : `You unfollowed ${req.params.name}.`);
    res.redirect(`/u/${req.params.name}`);
  });

  post('/u/:name/ban', requireUser, (req, res) => {
    forum.ban(req.user, req.params.name, req.body.days, req.body.reason);
    res.flash('ok', `${req.params.name} has been banned.`);
    res.redirect(`/u/${req.params.name}`);
  });

  post('/u/:name/unban', requireUser, (req, res) => {
    forum.unban(req.user, req.params.name);
    res.flash('ok', `Ban lifted for ${req.params.name}.`);
    res.redirect(`/u/${req.params.name}`);
  });

  app.get('/settings', requireUser, h((req, res) => res.send(V.settingsPage(req.ctx, { user: forum.getUserById(req.user.id) }))));

  post('/settings', requireUser, (req, res) => {
    forum.updateProfile(req.user.id, req.body);
    res.flash('ok', 'Profile saved.');
    res.redirect('/settings');
  });

  post('/settings/avatar', requireUser, upload.single('avatar'), (req, res) => {
    forum.setAvatar(req.user.id, req.file);
    res.flash('ok', 'Photo updated.');
    res.redirect('/settings');
  });

  post('/settings/password', requireUser, (req, res) => {
    forum.changePassword(req.user.id, req.body.current, req.body.next);
    cookie(res, SESSION_COOKIE, '', { maxAge: 0 });
    res.flash('ok', 'Password changed. Please log in again.');
    res.redirect('/login');
  });

  app.get('/notifications', requireUser, h((req, res) => {
    const items = forum.notifications(req.user.id);
    forum.markAllRead(req.user.id);
    req.ctx.unread = 0;
    res.send(V.notificationsPage(req.ctx, { items }));
  }));

  app.get('/followed', requireUser, h((req, res) => {
    const page = pageNum(req.query.page);
    res.send(
      V.listingPage(req.ctx, {
        title: 'Following',
        hint: 'Topics from members, boards and threads you follow.',
        list: forum.followedFeed(req.user.id, page),
        page,
        base: '/followed',
      }),
    );
  }));

  // ---------- moderation & admin ----------
  app.get('/mod/reports', requireUser, h((req, res) => res.send(V.reportsPage(req.ctx, { reports: forum.openReports(req.user) }))));
  post('/mod/reports/:id', requireUser, (req, res) => {
    forum.closeReport(req.user, Number(req.params.id), req.body.status);
    res.flash('ok', `Report ${req.body.status}.`);
    res.redirect('/mod/reports');
  });
  app.get('/mod/log', requireUser, h((req, res) => res.send(V.modLogPage(req.ctx, { entries: forum.modLog(req.user) }))));

  const requireAdmin = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new ForumError(403, 'Admins only.')));

  app.get('/admin', requireUser, requireAdmin, h((req, res) => {
    res.send(
      V.adminPage(req.ctx, {
        sections: db.prepare('SELECT * FROM sections ORDER BY position').all(),
        boards: forum.allBoards(),
        staff: forum.staff(),
      }),
    );
  }));
  post('/admin/sections', requireUser, requireAdmin, (req, res) => {
    forum.createSection(req.body.name);
    res.flash('ok', 'Section created.');
    res.redirect('/admin');
  });
  post('/admin/boards', requireUser, requireAdmin, (req, res) => {
    const id = forum.createBoard({
      sectionId: Number(req.body.section_id),
      parentId: req.body.parent_id ? Number(req.body.parent_id) : null,
      name: req.body.name,
      description: req.body.description,
    });
    const slug = db.prepare('SELECT slug FROM boards WHERE id = ?').get(id).slug;
    res.flash('ok', 'Board created.');
    res.redirect(`/b/${slug}`);
  });
  post('/admin/mods', requireUser, requireAdmin, (req, res) => {
    forum.setBoardMod(req.user, req.body.board, req.body.username, req.body.assign === '1');
    res.flash('ok', 'Moderators updated.');
    res.redirect('/admin');
  });
  post('/admin/roles', requireUser, requireAdmin, (req, res) => {
    forum.setRole(req.user, req.body.username, req.body.role);
    res.flash('ok', 'Role updated.');
    res.redirect('/admin');
  });

  // ---------- errors ----------
  app.use((req, _res, next) => next(new ForumError(404, 'That page does not exist.')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 2 MB or smaller.' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'You can attach up to 4 images.' : err.message;
    } else if (!(err instanceof ForumError)) {
      console.error(err);
      message = 'Something broke on our side. Please try again.';
    }
    const ctx = req.ctx || { user: null, csrf: '', unread: 0 };
    if (wantsJson(req)) return res.status(status).json({ error: message });
    res.status(status).send(V.errorPage(ctx, status, message));
  });

  app.locals.forum = forum;
  return app;
}
