// Domain service: every forum operation, persisted in SQLite.
import { tx } from '../db.js';
import { hashPassword, verifyPassword, randomToken } from './security.js';
import { slugify, extractMentions, extractQuotedPostIds } from './format.js';

export class ForumError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const TOPICS_PER_PAGE = 20;
export const POSTS_PER_PAGE = 15;
export const ONLINE_WINDOW_MIN = 15;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SESSION_DAYS = 30;

const RESERVED = new Set(['admin', 'mod', 'moderator', 'system', 'gisthall', 'support', 'root']);

export function createForum(db, { floodSeconds = 0 } = {}) {
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...p) => q(sql).get(...p);
  const all = (sql, ...p) => q(sql).all(...p);
  const run = (sql, ...p) => q(sql).run(...p);

  // ---------- users & auth ----------
  function validateUsername(username) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username || ''))
      throw new ForumError(400, 'Username must be 3–20 letters, numbers or underscores.');
    if (RESERVED.has(username.toLowerCase())) throw new ForumError(400, 'That username is reserved.');
  }

  function register({ username, email, password, role = 'member', allowReserved = false }) {
    username = String(username || '').trim();
    email = String(email || '').trim();
    if (!allowReserved) validateUsername(username);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ForumError(400, 'Enter a valid email address.');
    if (String(password || '').length < 8) throw new ForumError(400, 'Password must be at least 8 characters.');
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new ForumError(409, 'That username is taken.');
    if (one('SELECT 1 FROM users WHERE email = ?', email))
      throw new ForumError(409, 'An account with that email already exists.');
    const { lastInsertRowid } = run(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      username,
      email,
      hashPassword(password),
      role,
    );
    return getUserById(Number(lastInsertRowid));
  }

  function authenticate(login, password) {
    const user = one('SELECT * FROM users WHERE username = ? OR email = ?', String(login || '').trim(), String(login || '').trim());
    if (!user || !verifyPassword(String(password || ''), user.password_hash))
      throw new ForumError(401, 'Wrong username or password.');
    return user;
  }

  function changePassword(userId, current, next) {
    const user = getUserById(userId);
    if (!verifyPassword(String(current || ''), user.password_hash))
      throw new ForumError(400, 'Current password is wrong.');
    if (String(next || '').length < 8) throw new ForumError(400, 'New password must be at least 8 characters.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), userId);
    run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  function createSession(userId) {
    const token = randomToken();
    const csrf = randomToken(18);
    run(
      `INSERT INTO sessions (token, user_id, csrf, expires_at) VALUES (?, ?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
      token,
      userId,
      csrf,
    );
    return { token, csrf };
  }

  function getSession(token) {
    if (!token) return null;
    return one(
      `SELECT s.token, s.csrf, u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
      token,
    );
  }

  const destroySession = (token) => run('DELETE FROM sessions WHERE token = ?', token);

  function touch(userId) {
    run(
      `UPDATE users SET last_seen = datetime('now') WHERE id = ? AND last_seen < datetime('now', '-30 seconds')`,
      userId,
    );
  }

  const getUserById = (id) => one('SELECT * FROM users WHERE id = ?', id);
  const getUserByName = (name) => one('SELECT * FROM users WHERE username = ?', String(name || ''));

  function isBanned(user) {
    return !!(user && user.banned_until && Date.parse(`${user.banned_until.replace(' ', 'T')}Z`) > Date.now());
  }

  function assertCanPost(user) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    if (isBanned(user)) throw new ForumError(403, `You are banned until ${user.banned_until} UTC. Reason: ${user.ban_reason || '—'}`);
    if (floodSeconds > 0 && user.role === 'member') {
      const recent = one(
        `SELECT 1 FROM posts WHERE user_id = ? AND created_at > datetime('now', ?)`,
        user.id,
        `-${floodSeconds} seconds`,
      );
      if (recent) throw new ForumError(429, `Please wait ${floodSeconds} seconds between posts.`);
    }
  }

  function updateProfile(userId, { bio = '', location = '', gender = '', signature = '' }) {
    if (!['', 'male', 'female', 'other'].includes(gender)) throw new ForumError(400, 'Invalid gender value.');
    run(
      'UPDATE users SET bio = ?, location = ?, gender = ?, signature = ? WHERE id = ?',
      String(bio).slice(0, 1000),
      String(location).slice(0, 80),
      gender,
      String(signature).slice(0, 200),
      userId,
    );
  }

  function setAvatar(userId, file) {
    checkImage(file);
    return tx(db, () => {
      const old = one('SELECT avatar_id FROM users WHERE id = ?', userId)?.avatar_id;
      const id = saveAttachment(userId, null, 'avatar', file);
      run('UPDATE users SET avatar_id = ? WHERE id = ?', id, userId);
      if (old) run(`DELETE FROM attachments WHERE id = ? AND kind = 'avatar'`, old);
      return id;
    });
  }

  // ---------- attachments ----------
  function checkImage(file) {
    if (!file) throw new ForumError(400, 'No file uploaded.');
    if (!IMAGE_MIMES.has(file.mimetype)) throw new ForumError(400, 'Only PNG, JPEG, GIF or WebP images are allowed.');
    if (file.size > MAX_IMAGE_BYTES) throw new ForumError(400, 'Images must be 2 MB or smaller.');
    const b = file.buffer;
    const ok =
      (b[0] === 0x89 && b[1] === 0x50) || // png
      (b[0] === 0xff && b[1] === 0xd8) || // jpeg
      (b[0] === 0x47 && b[1] === 0x49) || // gif
      (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP');
    if (!ok) throw new ForumError(400, 'That file does not look like an image.');
  }

  function saveAttachment(userId, postId, kind, file) {
    const { lastInsertRowid } = run(
      'INSERT INTO attachments (post_id, user_id, kind, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)',
      postId,
      userId,
      kind,
      file.mimetype,
      file.size,
      file.buffer,
    );
    return Number(lastInsertRowid);
  }

  const getAttachment = (id) => one('SELECT id, mime, size, data FROM attachments WHERE id = ?', id);

  // ---------- sections & boards ----------
  function directory() {
    const sections = all('SELECT * FROM sections ORDER BY position, id');
    const boards = all('SELECT * FROM boards WHERE parent_id IS NULL ORDER BY position, name');
    return sections.map((s) => ({ ...s, boards: boards.filter((b) => b.section_id === s.id) }));
  }

  function getBoard(slug) {
    const board = one(
      'SELECT b.*, s.name AS section_name FROM boards b JOIN sections s ON s.id = b.section_id WHERE b.slug = ?',
      slug,
    );
    if (!board) throw new ForumError(404, 'Board not found.');
    board.children = all('SELECT * FROM boards WHERE parent_id = ? ORDER BY position, name', board.id);
    board.parent = board.parent_id ? one('SELECT * FROM boards WHERE id = ?', board.parent_id) : null;
    board.mods = all(
      'SELECT u.id, u.username FROM board_mods m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.username',
      board.id,
    );
    return board;
  }

  const allBoards = () =>
    all('SELECT b.id, b.name, b.slug, s.name AS section_name FROM boards b JOIN sections s ON s.id = b.section_id ORDER BY s.position, b.position, b.name');

  const TOPIC_COLS = `t.*, u.username AS author, lu.username AS last_poster, b.name AS board_name, b.slug AS board_slug`;
  const TOPIC_JOIN = `FROM topics t JOIN users u ON u.id = t.user_id
    LEFT JOIN users lu ON lu.id = t.last_post_user_id JOIN boards b ON b.id = t.board_id`;

  function boardTopics(boardId, page = 1, { includeHidden = false } = {}) {
    const where = `t.board_id = ?${includeHidden ? '' : ' AND t.hidden = 0'}`;
    const total = one(`SELECT COUNT(*) AS n FROM topics t WHERE ${where}`, boardId).n;
    const topics = all(
      `SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE ${where}
       ORDER BY t.sticky DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      boardId,
      TOPICS_PER_PAGE,
      (page - 1) * TOPICS_PER_PAGE,
    );
    return { topics, total, pages: Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)) };
  }

  function createSection(name) {
    name = String(name || '').trim();
    if (!name) throw new ForumError(400, 'Section name is required.');
    const pos = one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM sections').p;
    return Number(run('INSERT INTO sections (name, position) VALUES (?, ?)', name, pos).lastInsertRowid);
  }

  function createBoard({ sectionId, parentId = null, name, description = '', slug }) {
    name = String(name || '').trim();
    if (!name) throw new ForumError(400, 'Board name is required.');
    if (!one('SELECT 1 FROM sections WHERE id = ?', sectionId)) throw new ForumError(400, 'Choose a section.');
    slug = slugify(slug || name);
    if (one('SELECT 1 FROM boards WHERE slug = ?', slug)) throw new ForumError(409, 'A board with that address already exists.');
    const pos = one('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM boards WHERE section_id = ?', sectionId).p;
    return Number(
      run(
        'INSERT INTO boards (section_id, parent_id, name, slug, description, position) VALUES (?, ?, ?, ?, ?, ?)',
        sectionId,
        parentId || null,
        name,
        slug,
        String(description).trim(),
        pos,
      ).lastInsertRowid,
    );
  }

  // ---------- topics & posts ----------
  function getTopic(id, { includeHidden = false } = {}) {
    const topic = one(`SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE t.id = ?`, id);
    if (!topic || (topic.hidden && !includeHidden)) throw new ForumError(404, 'Topic not found.');
    return topic;
  }

  function addPost(user, topicId, body, files = []) {
    const postId = Number(
      run('INSERT INTO posts (topic_id, user_id, body) VALUES (?, ?, ?)', topicId, user.id, body).lastInsertRowid,
    );
    for (const f of files) saveAttachment(user.id, postId, 'post', f);
    run('UPDATE users SET post_count = post_count + 1 WHERE id = ?', user.id);
    return postId;
  }

  function cleanBody(body) {
    body = String(body || '').replace(/\r\n/g, '\n').trim();
    if (body.length < 2) throw new ForumError(400, 'Your post is empty.');
    if (body.length > 20000) throw new ForumError(400, 'Posts are limited to 20,000 characters.');
    return body;
  }

  function createTopic(user, boardSlug, { title, body }, files = []) {
    assertCanPost(user);
    const board = getBoard(boardSlug);
    title = String(title || '').replace(/\s+/g, ' ').trim();
    if (title.length < 5 || title.length > 150) throw new ForumError(400, 'Titles must be 5–150 characters.');
    body = cleanBody(body);
    files.forEach(checkImage);
    return tx(db, () => {
      const topicId = Number(
        run(
          'INSERT INTO topics (board_id, user_id, title, slug, last_post_user_id) VALUES (?, ?, ?, ?, ?)',
          board.id,
          user.id,
          title,
          slugify(title),
          user.id,
        ).lastInsertRowid,
      );
      const postId = addPost(user, topicId, body, files);
      run('UPDATE users SET topic_count = topic_count + 1 WHERE id = ?', user.id);
      run('UPDATE boards SET topic_count = topic_count + 1, post_count = post_count + 1 WHERE id = ?', board.id);
      run('INSERT OR IGNORE INTO topic_follows (user_id, topic_id) VALUES (?, ?)', user.id, topicId);
      // Followers of the author and of the board hear about the new topic.
      const watchers = all(
        `SELECT follower_id AS id FROM follows WHERE followee_id = ?
         UNION SELECT user_id FROM board_follows WHERE board_id = ?`,
        user.id,
        board.id,
      );
      for (const w of watchers) notify(w.id, 'new_topic', user.id, topicId, postId);
      notifyMentionsAndQuotes(user, topicId, postId, body);
      return { topicId, postId, slug: slugify(title) };
    });
  }

  function reply(user, topicId, body, files = []) {
    assertCanPost(user);
    const topic = getTopic(topicId);
    if (topic.locked && !canModerate(user, topic.board_id)) throw new ForumError(403, 'This topic is locked.');
    body = cleanBody(body);
    files.forEach(checkImage);
    return tx(db, () => {
      const postId = addPost(user, topicId, body, files);
      run(
        `UPDATE topics SET reply_count = reply_count + 1, last_post_at = datetime('now'), last_post_user_id = ? WHERE id = ?`,
        user.id,
        topicId,
      );
      run('UPDATE boards SET post_count = post_count + 1 WHERE id = ?', topic.board_id);
      const notified = notifyMentionsAndQuotes(user, topicId, postId, body);
      for (const f of all('SELECT user_id FROM topic_follows WHERE topic_id = ?', topicId)) {
        if (!notified.has(f.user_id)) notify(f.user_id, 'reply', user.id, topicId, postId);
      }
      run('INSERT OR IGNORE INTO topic_follows (user_id, topic_id) VALUES (?, ?)', user.id, topicId);
      return postId;
    });
  }

  function notifyMentionsAndQuotes(user, topicId, postId, body) {
    const notified = new Set([user.id]);
    for (const qid of extractQuotedPostIds(body)) {
      const quoted = one('SELECT user_id FROM posts WHERE id = ?', qid);
      if (quoted && !notified.has(quoted.user_id)) {
        notify(quoted.user_id, 'quote', user.id, topicId, postId);
        notified.add(quoted.user_id);
      }
    }
    for (const name of extractMentions(body)) {
      const target = getUserByName(name);
      if (target && !notified.has(target.id)) {
        notify(target.id, 'mention', user.id, topicId, postId);
        notified.add(target.id);
      }
    }
    return notified;
  }

  function notify(userId, kind, actorId, topicId = null, postId = null) {
    if (userId === actorId) return;
    run(
      'INSERT INTO notifications (user_id, kind, actor_id, topic_id, post_id) VALUES (?, ?, ?, ?, ?)',
      userId,
      kind,
      actorId,
      topicId,
      postId,
    );
  }

  function addView(topicId) {
    run('UPDATE topics SET views = views + 1 WHERE id = ?', topicId);
  }

  function attachmentsFor(postIds) {
    if (!postIds.length) return new Map();
    const rows = all(
      `SELECT id, post_id, mime, size FROM attachments WHERE post_id IN (${postIds.map(() => '?').join(',')}) ORDER BY id`,
      ...postIds,
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.post_id)) map.set(r.post_id, []);
      map.get(r.post_id).push(r);
    }
    return map;
  }

  const POST_COLS = `p.*, u.username, u.avatar_id, u.role, u.post_count AS author_posts, u.signature,
    u.location, u.gender, u.created_at AS author_joined, u.last_seen AS author_last_seen`;

  function decoratePosts(posts, viewerId) {
    const atts = attachmentsFor(posts.map((p) => p.id));
    const liked = new Set();
    const shared = new Set();
    if (viewerId && posts.length) {
      const ph = posts.map(() => '?').join(',');
      const ids = posts.map((p) => p.id);
      all(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${ph})`, viewerId, ...ids).forEach((r) => liked.add(r.post_id));
      all(`SELECT post_id FROM shares WHERE user_id = ? AND post_id IN (${ph})`, viewerId, ...ids).forEach((r) => shared.add(r.post_id));
    }
    return posts.map((p) => ({ ...p, attachments: atts.get(p.id) || [], liked: liked.has(p.id), shared: shared.has(p.id) }));
  }

  function topicPosts(topicId, page = 1, viewerId = null) {
    const total = one('SELECT COUNT(*) AS n FROM posts WHERE topic_id = ?', topicId).n;
    const posts = all(
      `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.topic_id = ? ORDER BY p.id LIMIT ? OFFSET ?`,
      topicId,
      POSTS_PER_PAGE,
      (page - 1) * POSTS_PER_PAGE,
    );
    return { posts: decoratePosts(posts, viewerId), total, pages: Math.max(1, Math.ceil(total / POSTS_PER_PAGE)) };
  }

  function getPost(id) {
    const post = one(
      `SELECT p.*, u.username, t.board_id, t.title AS topic_title, t.slug AS topic_slug, t.locked, t.hidden AS topic_hidden
       FROM posts p JOIN users u ON u.id = p.user_id JOIN topics t ON t.id = p.topic_id WHERE p.id = ?`,
      id,
    );
    if (!post) throw new ForumError(404, 'Post not found.');
    return post;
  }

  /** 1-based page of the topic on which a post appears. */
  function postPage(post) {
    const before = one('SELECT COUNT(*) AS n FROM posts WHERE topic_id = ? AND id < ?', post.topic_id, post.id).n;
    return Math.floor(before / POSTS_PER_PAGE) + 1;
  }

  function editPost(user, postId, body, title) {
    const post = getPost(postId);
    const isMod = canModerate(user, post.board_id);
    if (!user || (post.user_id !== user.id && !isMod)) throw new ForumError(403, 'You can only edit your own posts.');
    if (isBanned(user)) throw new ForumError(403, 'Banned members cannot edit posts.');
    body = cleanBody(body);
    tx(db, () => {
      run('INSERT INTO post_edits (post_id, editor_id, old_body) VALUES (?, ?, ?)', postId, user.id, post.body);
      run(`UPDATE posts SET body = ?, edited_at = datetime('now'), edit_count = edit_count + 1 WHERE id = ?`, body, postId);
      const first = one('SELECT MIN(id) AS id FROM posts WHERE topic_id = ?', post.topic_id).id;
      if (title !== undefined && first === postId) {
        title = String(title).replace(/\s+/g, ' ').trim();
        if (title.length < 5 || title.length > 150) throw new ForumError(400, 'Titles must be 5–150 characters.');
        run('UPDATE topics SET title = ?, slug = ? WHERE id = ?', title, slugify(title), post.topic_id);
      }
    });
    return getPost(postId);
  }

  const postEdits = (postId) =>
    all(
      `SELECT e.*, u.username AS editor FROM post_edits e JOIN users u ON u.id = e.editor_id WHERE e.post_id = ? ORDER BY e.id DESC`,
      postId,
    );

  function toggle(table, counter, user, postId, kind) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    const post = getPost(postId);
    if (post.hidden) throw new ForumError(404, 'Post not found.');
    return tx(db, () => {
      const exists = one(`SELECT 1 FROM ${table} WHERE post_id = ? AND user_id = ?`, postId, user.id);
      if (exists) {
        run(`DELETE FROM ${table} WHERE post_id = ? AND user_id = ?`, postId, user.id);
        run(`UPDATE posts SET ${counter} = ${counter} - 1 WHERE id = ?`, postId);
        if (table === 'likes') run('UPDATE users SET likes_received = likes_received - 1 WHERE id = ?', post.user_id);
      } else {
        run(`INSERT INTO ${table} (post_id, user_id) VALUES (?, ?)`, postId, user.id);
        run(`UPDATE posts SET ${counter} = ${counter} + 1 WHERE id = ?`, postId);
        if (table === 'likes') run('UPDATE users SET likes_received = likes_received + 1 WHERE id = ?', post.user_id);
        notify(post.user_id, kind, user.id, post.topic_id, postId);
      }
      const count = one(`SELECT ${counter} AS n FROM posts WHERE id = ?`, postId).n;
      return { active: !exists, count };
    });
  }

  const toggleLike = (user, postId) => toggle('likes', 'like_count', user, postId, 'like');
  const toggleShare = (user, postId) => toggle('shares', 'share_count', user, postId, 'share');

  function postLikers(postId) {
    return all(
      'SELECT u.username FROM likes l JOIN users u ON u.id = l.user_id WHERE l.post_id = ? ORDER BY l.created_at DESC LIMIT 50',
      postId,
    );
  }

  function report(user, postId, reason) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    getPost(postId);
    reason = String(reason || '').trim();
    if (reason.length < 3) throw new ForumError(400, 'Tell the moderators what is wrong.');
    if (one(`SELECT 1 FROM reports WHERE post_id = ? AND reporter_id = ? AND status = 'open'`, postId, user.id))
      throw new ForumError(409, 'You have already reported this post.');
    run('INSERT INTO reports (post_id, reporter_id, reason) VALUES (?, ?, ?)', postId, user.id, reason.slice(0, 500));
  }

  // ---------- following ----------
  function toggleFollowUser(user, username) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    const target = getUserByName(username);
    if (!target) throw new ForumError(404, 'Member not found.');
    if (target.id === user.id) throw new ForumError(400, "You can't follow yourself.");
    if (one('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', user.id, target.id)) {
      run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', user.id, target.id);
      return false;
    }
    run('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)', user.id, target.id);
    notify(target.id, 'follow', user.id);
    return true;
  }

  function toggleFollowTopic(user, topicId) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    getTopic(topicId);
    if (one('SELECT 1 FROM topic_follows WHERE user_id = ? AND topic_id = ?', user.id, topicId)) {
      run('DELETE FROM topic_follows WHERE user_id = ? AND topic_id = ?', user.id, topicId);
      return false;
    }
    run('INSERT INTO topic_follows (user_id, topic_id) VALUES (?, ?)', user.id, topicId);
    return true;
  }

  function toggleFollowBoard(user, slug) {
    if (!user) throw new ForumError(401, 'Please log in first.');
    const board = getBoard(slug);
    if (one('SELECT 1 FROM board_follows WHERE user_id = ? AND board_id = ?', user.id, board.id)) {
      run('DELETE FROM board_follows WHERE user_id = ? AND board_id = ?', user.id, board.id);
      return false;
    }
    run('INSERT INTO board_follows (user_id, board_id) VALUES (?, ?)', user.id, board.id);
    return true;
  }

  const isFollowingUser = (uid, tid) => !!one('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', uid, tid);
  const isFollowingTopic = (uid, tid) => !!one('SELECT 1 FROM topic_follows WHERE user_id = ? AND topic_id = ?', uid, tid);
  const isFollowingBoard = (uid, bid) => !!one('SELECT 1 FROM board_follows WHERE user_id = ? AND board_id = ?', uid, bid);

  const followers = (userId) =>
    all('SELECT u.username, u.avatar_id FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC', userId);
  const following = (userId) =>
    all('SELECT u.username, u.avatar_id FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC', userId);

  /** Topics from followed members, followed boards and followed topics. */
  function followedFeed(userId, page = 1) {
    const where = `t.hidden = 0 AND (t.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $u)
      OR t.board_id IN (SELECT board_id FROM board_follows WHERE user_id = $u)
      OR t.id IN (SELECT topic_id FROM topic_follows WHERE user_id = $u))`;
    const total = q(`SELECT COUNT(*) AS n FROM topics t WHERE ${where}`).get({ u: userId }).n;
    const topics = q(`SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE ${where} ORDER BY t.last_post_at DESC, t.id DESC LIMIT $l OFFSET $o`).all({
      u: userId,
      l: TOPICS_PER_PAGE,
      o: (page - 1) * TOPICS_PER_PAGE,
    });
    return { topics, total, pages: Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)) };
  }

  // ---------- notifications ----------
  const unreadCount = (userId) => one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;

  function notifications(userId, limit = 50) {
    return all(
      `SELECT n.*, a.username AS actor, t.title AS topic_title, t.slug AS topic_slug
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN topics t ON t.id = n.topic_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT ?`,
      userId,
      limit,
    );
  }

  const markAllRead = (userId) => run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, userId);

  // ---------- listings ----------
  function frontPage(limit = 40) {
    return all(`SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE t.featured_at IS NOT NULL AND t.hidden = 0 ORDER BY t.featured_at DESC LIMIT ?`, limit);
  }

  function recentTopics(page = 1) {
    const total = one('SELECT COUNT(*) AS n FROM topics WHERE hidden = 0').n;
    const topics = all(
      `SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE t.hidden = 0 ORDER BY t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      TOPICS_PER_PAGE,
      (page - 1) * TOPICS_PER_PAGE,
    );
    return { topics, total, pages: Math.max(1, Math.ceil(total / TOPICS_PER_PAGE)) };
  }

  function trendingTopics(limit = 30) {
    return all(
      `SELECT ${TOPIC_COLS}, (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id AND p.created_at > datetime('now','-2 days')) AS recent_posts
       ${TOPIC_JOIN} WHERE t.hidden = 0
       ORDER BY recent_posts DESC, t.views DESC, t.last_post_at DESC LIMIT ?`,
      limit,
    );
  }

  function stats() {
    return {
      members: one('SELECT COUNT(*) AS n FROM users').n,
      topics: one('SELECT COUNT(*) AS n FROM topics WHERE hidden = 0').n,
      posts: one('SELECT COUNT(*) AS n FROM posts').n,
      online: one(`SELECT COUNT(*) AS n FROM users WHERE last_seen > datetime('now', '-${ONLINE_WINDOW_MIN} minutes')`).n,
      newest: one('SELECT username FROM users ORDER BY id DESC LIMIT 1')?.username,
    };
  }

  const onlineUsers = () =>
    all(`SELECT username, role, last_seen FROM users WHERE last_seen > datetime('now', '-${ONLINE_WINDOW_MIN} minutes') ORDER BY last_seen DESC`);

  // ---------- profiles ----------
  function profile(username) {
    const user = getUserByName(username);
    if (!user) throw new ForumError(404, 'Member not found.');
    user.followers = one('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?', user.id).n;
    user.following = one('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', user.id).n;
    user.mod_boards = all(
      'SELECT b.name, b.slug FROM board_mods m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? ORDER BY b.name',
      user.id,
    );
    return user;
  }

  const userTopics = (userId, limit = 30) =>
    all(`SELECT ${TOPIC_COLS} ${TOPIC_JOIN} WHERE t.user_id = ? AND t.hidden = 0 ORDER BY t.id DESC LIMIT ?`, userId, limit);

  function userPosts(userId, viewerId, limit = 30) {
    const posts = all(
      `SELECT ${POST_COLS}, t.title AS topic_title, t.slug AS topic_slug FROM posts p JOIN users u ON u.id = p.user_id
       JOIN topics t ON t.id = p.topic_id WHERE p.user_id = ? AND t.hidden = 0 ORDER BY p.id DESC LIMIT ?`,
      userId,
      limit,
    );
    return decoratePosts(posts, viewerId);
  }

  // ---------- search ----------
  function ftsQuery(text) {
    const terms = String(text || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu);
    if (!terms) return null;
    return terms.slice(0, 8).map((t) => `"${t}"*`).join(' ');
  }

  function search(text, { type = 'topics', boardSlug = '', limit = 50 } = {}) {
    const match = ftsQuery(text);
    if (!match) return [];
    const board = boardSlug ? getBoard(boardSlug) : null;
    if (type === 'posts') {
      return all(
        `SELECT p.id, p.body, p.created_at, p.topic_id, u.username, t.title AS topic_title, t.slug AS topic_slug, b.name AS board_name
         FROM posts_fts f JOIN posts p ON p.id = f.rowid JOIN users u ON u.id = p.user_id
         JOIN topics t ON t.id = p.topic_id JOIN boards b ON b.id = t.board_id
         WHERE posts_fts MATCH ? AND p.hidden = 0 AND t.hidden = 0 ${board ? 'AND t.board_id = ?' : ''}
         ORDER BY rank LIMIT ?`,
        ...(board ? [match, board.id, limit] : [match, limit]),
      );
    }
    return all(
      `SELECT ${TOPIC_COLS} FROM topics_fts f JOIN topics t ON t.id = f.rowid JOIN users u ON u.id = t.user_id
       LEFT JOIN users lu ON lu.id = t.last_post_user_id JOIN boards b ON b.id = t.board_id
       WHERE topics_fts MATCH ? AND t.hidden = 0 ${board ? 'AND t.board_id = ?' : ''}
       ORDER BY rank LIMIT ?`,
      ...(board ? [match, board.id, limit] : [match, limit]),
    );
  }

  // ---------- moderation ----------
  function canModerate(user, boardId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role !== 'mod') return false;
    return !!one('SELECT 1 FROM board_mods WHERE board_id = ? AND user_id = ?', boardId, user.id);
  }

  const isStaff = (user) => !!user && (user.role === 'admin' || user.role === 'mod');

  function assertMod(user, boardId) {
    if (!canModerate(user, boardId)) throw new ForumError(403, 'Moderators only.');
  }

  function log(modId, action, targetType, targetId, detail = '') {
    run('INSERT INTO mod_log (mod_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)', modId, action, targetType, targetId, detail);
  }

  function setTopicFlag(user, topicId, flag, value) {
    const topic = getTopic(topicId, { includeHidden: true });
    assertMod(user, topic.board_id);
    const cols = { sticky: 'sticky', locked: 'locked', hidden: 'hidden' };
    if (flag === 'featured') {
      run(`UPDATE topics SET featured_at = ${value ? "datetime('now')" : 'NULL'} WHERE id = ?`, topicId);
    } else if (cols[flag]) {
      run(`UPDATE topics SET ${cols[flag]} = ? WHERE id = ?`, value ? 1 : 0, topicId);
    } else {
      throw new ForumError(400, 'Unknown action.');
    }
    log(user.id, `${value ? '' : 'un'}${flag}`, 'topic', topicId, topic.title);
  }

  function moveTopic(user, topicId, boardSlug) {
    const topic = getTopic(topicId, { includeHidden: true });
    assertMod(user, topic.board_id);
    const target = getBoard(boardSlug);
    if (target.id === topic.board_id) return;
    tx(db, () => {
      const posts = topic.reply_count + 1;
      run('UPDATE topics SET board_id = ? WHERE id = ?', target.id, topicId);
      run('UPDATE boards SET topic_count = topic_count - 1, post_count = post_count - ? WHERE id = ?', posts, topic.board_id);
      run('UPDATE boards SET topic_count = topic_count + 1, post_count = post_count + ? WHERE id = ?', posts, target.id);
      log(user.id, 'move', 'topic', topicId, `${topic.board_name} → ${target.name}`);
    });
  }

  function setPostHidden(user, postId, hidden) {
    const post = getPost(postId);
    assertMod(user, post.board_id);
    run('UPDATE posts SET hidden = ? WHERE id = ?', hidden ? 1 : 0, postId);
    if (hidden) notify(post.user_id, 'post_hidden', user.id, post.topic_id, postId);
    log(user.id, hidden ? 'hide' : 'unhide', 'post', postId, post.topic_title);
  }

  function ban(user, username, days, reason) {
    if (!isStaff(user)) throw new ForumError(403, 'Moderators only.');
    const target = getUserByName(username);
    if (!target) throw new ForumError(404, 'Member not found.');
    if (target.role === 'admin' || (target.role === 'mod' && user.role !== 'admin'))
      throw new ForumError(403, 'You cannot ban that member.');
    days = Math.max(1, Math.min(3650, parseInt(days, 10) || 1));
    run(`UPDATE users SET banned_until = datetime('now', ?), ban_reason = ? WHERE id = ?`, `+${days} days`, String(reason || '').slice(0, 200), target.id);
    run('DELETE FROM sessions WHERE user_id = ?', target.id);
    log(user.id, 'ban', 'user', target.id, `${days} day(s): ${reason || ''}`);
  }

  function unban(user, username) {
    if (!isStaff(user)) throw new ForumError(403, 'Moderators only.');
    const target = getUserByName(username);
    if (!target) throw new ForumError(404, 'Member not found.');
    run(`UPDATE users SET banned_until = NULL, ban_reason = '' WHERE id = ?`, target.id);
    log(user.id, 'unban', 'user', target.id, '');
  }

  function openReports(user) {
    if (!isStaff(user)) throw new ForumError(403, 'Moderators only.');
    const rows = all(
      `SELECT r.*, ru.username AS reporter, p.body, p.hidden AS post_hidden, pu.username AS author, t.id AS topic_id,
              t.title AS topic_title, t.board_id
       FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN posts p ON p.id = r.post_id
       JOIN users pu ON pu.id = p.user_id JOIN topics t ON t.id = p.topic_id
       WHERE r.status = 'open' ORDER BY r.id DESC`,
    );
    return rows.filter((r) => canModerate(user, r.board_id));
  }

  function closeReport(user, reportId, status) {
    if (!['resolved', 'dismissed'].includes(status)) throw new ForumError(400, 'Unknown status.');
    const r = one('SELECT r.*, t.board_id FROM reports r JOIN posts p ON p.id = r.post_id JOIN topics t ON t.id = p.topic_id WHERE r.id = ?', reportId);
    if (!r) throw new ForumError(404, 'Report not found.');
    assertMod(user, r.board_id);
    run(`UPDATE reports SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`, status, user.id, reportId);
    log(user.id, status, 'report', reportId, `post ${r.post_id}`);
  }

  function modLog(user, limit = 100) {
    if (!isStaff(user)) throw new ForumError(403, 'Moderators only.');
    return all('SELECT l.*, u.username AS mod FROM mod_log l JOIN users u ON u.id = l.mod_id ORDER BY l.id DESC LIMIT ?', limit);
  }

  // ---------- admin ----------
  function assertAdmin(user) {
    if (!user || user.role !== 'admin') throw new ForumError(403, 'Admins only.');
  }

  function setRole(admin, username, role) {
    assertAdmin(admin);
    if (!['member', 'mod', 'admin'].includes(role)) throw new ForumError(400, 'Unknown role.');
    const target = getUserByName(username);
    if (!target) throw new ForumError(404, 'Member not found.');
    if (target.id === admin.id) throw new ForumError(400, 'You cannot change your own role.');
    run('UPDATE users SET role = ? WHERE id = ?', role, target.id);
    log(admin.id, `role:${role}`, 'user', target.id, '');
  }

  function setBoardMod(admin, boardSlug, username, assign) {
    assertAdmin(admin);
    const board = getBoard(boardSlug);
    const target = getUserByName(username);
    if (!target) throw new ForumError(404, 'Member not found.');
    if (assign) {
      if (target.role === 'member') run(`UPDATE users SET role = 'mod' WHERE id = ?`, target.id);
      run('INSERT OR IGNORE INTO board_mods (board_id, user_id) VALUES (?, ?)', board.id, target.id);
    } else {
      run('DELETE FROM board_mods WHERE board_id = ? AND user_id = ?', board.id, target.id);
    }
    log(admin.id, assign ? 'assign_mod' : 'remove_mod', 'board', board.id, target.username);
  }

  const staff = () => all(`SELECT id, username, role FROM users WHERE role IN ('admin','mod') ORDER BY role, username`);

  return {
    db,
    register, authenticate, changePassword, createSession, getSession, destroySession, touch,
    getUserById, getUserByName, isBanned, updateProfile, setAvatar, getAttachment,
    directory, getBoard, allBoards, boardTopics, createSection, createBoard,
    getTopic, createTopic, reply, addView, topicPosts, getPost, postPage, editPost, postEdits,
    toggleLike, toggleShare, postLikers, report,
    toggleFollowUser, toggleFollowTopic, toggleFollowBoard, isFollowingUser, isFollowingTopic, isFollowingBoard,
    followers, following, followedFeed,
    unreadCount, notifications, markAllRead,
    frontPage, recentTopics, trendingTopics, stats, onlineUsers,
    profile, userTopics, userPosts, search,
    canModerate, isStaff, setTopicFlag, moveTopic, setPostHidden, ban, unban, openReports, closeReport, modLog,
    setRole, setBoardMod, staff,
  };
}
