import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db.js';
import { createForum, ForumError } from '../../src/lib/forum.js';
import { seed } from '../../src/seed.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const img = (over = {}) => ({ mimetype: 'image/png', size: PNG.length, buffer: PNG, ...over });

let db, forum, admin, ada, bola, boardSlug;

beforeEach(() => {
  db = openDb(':memory:');
  forum = createForum(db);
  admin = forum.register({ username: 'boss', email: 'boss@x.test', password: 'password123', role: 'admin' });
  ada = forum.register({ username: 'ada', email: 'ada@x.test', password: 'password123' });
  bola = forum.register({ username: 'bola', email: 'bola@x.test', password: 'password123' });
  const s = forum.createSection('Naija');
  forum.createBoard({ sectionId: s, name: 'Tech Corner', description: 'code' });
  forum.createBoard({ sectionId: s, name: 'Football' });
  boardSlug = 'tech-corner';
});

const fresh = (u) => forum.getUserById(u.id);

test('registration validates input and rejects duplicates', () => {
  assert.throws(() => forum.register({ username: 'a', email: 'a@x.test', password: 'password123' }), /3–20/);
  assert.throws(() => forum.register({ username: 'admin', email: 'z@x.test', password: 'password123' }), /reserved/);
  assert.throws(() => forum.register({ username: 'ADA', email: 'other@x.test', password: 'password123' }), /taken/);
  assert.throws(() => forum.register({ username: 'cee', email: 'ADA@x.test', password: 'password123' }), /email/);
  assert.throws(() => forum.register({ username: 'cee', email: 'cee@x.test', password: 'short' }), /8 characters/);
});

test('authentication and sessions persist in the database', () => {
  assert.equal(forum.authenticate('ada', 'password123').id, ada.id);
  assert.equal(forum.authenticate('ada@x.test', 'password123').id, ada.id);
  assert.throws(() => forum.authenticate('ada', 'nope'), ForumError);
  const { token } = forum.createSession(ada.id);
  assert.equal(forum.getSession(token).username, 'ada');
  forum.destroySession(token);
  assert.equal(forum.getSession(token), undefined);
});

test('changing password invalidates sessions', () => {
  const { token } = forum.createSession(ada.id);
  assert.throws(() => forum.changePassword(ada.id, 'wrong', 'newpassword1'), /Current password/);
  forum.changePassword(ada.id, 'password123', 'newpassword1');
  assert.equal(forum.getSession(token), undefined);
  assert.equal(forum.authenticate('ada', 'newpassword1').id, ada.id);
});

test('createTopic and reply update counters, follows and notifications', () => {
  const { topicId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Best laptop for coding?', body: 'Budget is tight.' });
  const postId = forum.reply(fresh(bola), topicId, 'Get a used ThinkPad.');
  const topic = forum.getTopic(topicId);
  assert.equal(topic.reply_count, 1);
  assert.equal(topic.last_poster, 'bola');
  const board = forum.getBoard(boardSlug);
  assert.equal(board.topic_count, 1);
  assert.equal(board.post_count, 2);
  assert.equal(fresh(ada).post_count, 1);
  assert.equal(fresh(ada).topic_count, 1);
  assert.equal(fresh(bola).post_count, 1);
  // ada follows her own topic automatically, so she hears about the reply.
  const notes = forum.notifications(ada.id);
  assert.equal(notes[0].kind, 'reply');
  assert.equal(notes[0].post_id, postId);
  assert.ok(forum.isFollowingTopic(bola.id, topicId));
});

test('topic validation rejects short titles and empty bodies', () => {
  assert.throws(() => forum.createTopic(fresh(ada), boardSlug, { title: 'Hi', body: 'ok body' }), /5–150/);
  assert.throws(() => forum.createTopic(fresh(ada), boardSlug, { title: 'Valid title', body: ' ' }), /empty/);
  assert.throws(() => forum.createTopic(fresh(ada), 'nope', { title: 'Valid title', body: 'body' }), /Board not found/);
});

test('quotes and mentions notify the right people once', () => {
  const { topicId, postId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Quote me please', body: 'Original thought' });
  forum.reply(fresh(bola), topicId, `[quote author=ada post=${postId}]Original thought[/quote]\nAgreed @ada and @boss`);
  const adaKinds = forum.notifications(ada.id).map((n) => n.kind);
  assert.deepEqual(adaKinds, ['quote']);
  assert.deepEqual(forum.notifications(admin.id).map((n) => n.kind), ['mention']);
  assert.equal(forum.unreadCount(ada.id), 1);
  forum.markAllRead(ada.id);
  assert.equal(forum.unreadCount(ada.id), 0);
});

test('likes and shares toggle and keep counters consistent', () => {
  const { postId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Like this topic', body: 'Body text' });
  assert.deepEqual(forum.toggleLike(fresh(bola), postId), { active: true, count: 1 });
  assert.equal(fresh(ada).likes_received, 1);
  assert.deepEqual(forum.toggleLike(fresh(bola), postId), { active: false, count: 0 });
  assert.equal(fresh(ada).likes_received, 0);
  assert.deepEqual(forum.toggleShare(fresh(bola), postId), { active: true, count: 1 });
  assert.deepEqual(forum.notifications(ada.id).map((n) => n.kind).sort(), ['like', 'share']);
});

test('editing keeps history and only the author or a mod may edit', () => {
  const { topicId, postId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Editable topic', body: 'first version' });
  assert.throws(() => forum.editPost(fresh(bola), postId, 'hijack'), /own posts/);
  forum.editPost(fresh(ada), postId, 'second version', 'Edited topic title');
  assert.equal(forum.getPost(postId).body, 'second version');
  assert.equal(forum.getTopic(topicId).title, 'Edited topic title');
  assert.equal(forum.postEdits(postId)[0].old_body, 'first version');
  forum.editPost(fresh(admin), postId, 'admin fix');
  assert.equal(forum.getPost(postId).edit_count, 2);
});

test('locked topics block member replies but not moderators', () => {
  const { topicId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Lock this topic', body: 'body' });
  forum.setTopicFlag(fresh(admin), topicId, 'locked', true);
  assert.throws(() => forum.reply(fresh(bola), topicId, 'still here'), /locked/);
  assert.ok(forum.reply(fresh(admin), topicId, 'mod reply'));
});

test('board moderators can only moderate their own boards', () => {
  forum.setBoardMod(fresh(admin), 'football', 'bola', true);
  const mod = fresh(bola);
  assert.equal(mod.role, 'mod');
  const { topicId: tech } = forum.createTopic(fresh(ada), boardSlug, { title: 'Tech topic here', body: 'x y' });
  const { topicId: foot, postId } = forum.createTopic(fresh(ada), 'football', { title: 'Football topic', body: 'goal' });
  assert.throws(() => forum.setTopicFlag(mod, tech, 'sticky', true), /Moderators only/);
  forum.setTopicFlag(mod, foot, 'sticky', true);
  forum.setPostHidden(mod, postId, true);
  assert.equal(forum.getPost(postId).hidden, 1);
  assert.equal(forum.notifications(ada.id)[0].kind, 'post_hidden');
  assert.equal(forum.modLog(fresh(admin)).length >= 2, true);
});

test('feature, hide and move topics', () => {
  const { topicId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Wrong board topic', body: 'about football' });
  forum.setTopicFlag(fresh(admin), topicId, 'featured', true);
  assert.equal(forum.frontPage()[0].id, topicId);
  forum.moveTopic(fresh(admin), topicId, 'football');
  assert.equal(forum.getTopic(topicId).board_slug, 'football');
  assert.equal(forum.getBoard('football').topic_count, 1);
  assert.equal(forum.getBoard(boardSlug).topic_count, 0);
  forum.setTopicFlag(fresh(admin), topicId, 'hidden', true);
  assert.throws(() => forum.getTopic(topicId), /not found/);
  assert.equal(forum.frontPage().length, 0);
});

test('reports flow through the mod desk', () => {
  const { postId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Reported topic', body: 'buy followers cheap' });
  forum.report(fresh(bola), postId, 'Spam');
  assert.throws(() => forum.report(fresh(bola), postId, 'Spam again'), /already reported/);
  assert.throws(() => forum.openReports(fresh(bola)), /Moderators only/);
  const [r] = forum.openReports(fresh(admin));
  assert.equal(r.reason, 'Spam');
  forum.closeReport(fresh(admin), r.id, 'resolved');
  assert.equal(forum.openReports(fresh(admin)).length, 0);
});

test('bans block posting and kill sessions; unban restores', () => {
  const { token } = forum.createSession(bola.id);
  forum.ban(fresh(admin), 'bola', 3, 'insults');
  assert.equal(forum.getSession(token), undefined);
  assert.ok(forum.isBanned(fresh(bola)));
  assert.throws(() => forum.createTopic(fresh(bola), boardSlug, { title: 'Banned post', body: 'x y' }), /banned/);
  assert.throws(() => forum.ban(fresh(ada), 'bola', 3, 'x'), /Moderators only/);
  assert.throws(() => forum.ban(fresh(admin), 'boss', 3, 'x'), /cannot ban/);
  forum.unban(fresh(admin), 'bola');
  assert.ok(!forum.isBanned(fresh(bola)));
});

test('following members and boards feeds the followed list and alerts', () => {
  assert.equal(forum.toggleFollowUser(fresh(bola), 'ada'), true);
  assert.throws(() => forum.toggleFollowUser(fresh(bola), 'bola'), /yourself/);
  forum.toggleFollowBoard(fresh(admin), 'football');
  const { topicId } = forum.createTopic(fresh(ada), 'football', { title: 'Followed author topic', body: 'hello' });
  assert.equal(forum.followedFeed(bola.id).topics[0].id, topicId);
  assert.equal(forum.notifications(bola.id).find((n) => n.kind === 'new_topic').topic_id, topicId);
  assert.equal(forum.notifications(admin.id).find((n) => n.kind === 'new_topic').topic_id, topicId);
  assert.equal(forum.profile('ada').followers, 1);
  assert.equal(forum.toggleFollowUser(fresh(bola), 'ada'), false);
});

test('full-text search finds topics and posts, scoped by board', () => {
  forum.createTopic(fresh(ada), boardSlug, { title: 'Solar inverter recommendations', body: 'Which brand lasts longest?' });
  const { topicId } = forum.createTopic(fresh(ada), 'football', { title: 'Weekend fixtures', body: 'The derby is on Sunday' });
  assert.equal(forum.search('inverter')[0].title, 'Solar inverter recommendations');
  assert.equal(forum.search('solar', { boardSlug: 'football' }).length, 0);
  assert.equal(forum.search('derby', { type: 'posts' })[0].topic_id, topicId);
  assert.equal(forum.search('inver')[0].title, 'Solar inverter recommendations');
  assert.deepEqual(forum.search('***'), []);
});

test('image attachments are validated and stored as blobs', () => {
  const { postId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Topic with image', body: 'see pic' }, [img()]);
  const posts = forum.topicPosts(forum.getPost(postId).topic_id).posts;
  const att = forum.getAttachment(posts[0].attachments[0].id);
  assert.equal(att.mime, 'image/png');
  assert.equal(Buffer.from(att.data).equals(PNG), true);
  assert.throws(() => forum.createTopic(fresh(ada), boardSlug, { title: 'Bad image topic', body: 'x y' }, [img({ mimetype: 'text/html' })]), /Only PNG/);
  assert.throws(() => forum.createTopic(fresh(ada), boardSlug, { title: 'Fake image topic', body: 'x y' }, [img({ buffer: Buffer.from('<html>') })]), /does not look/);
  forum.setAvatar(ada.id, img());
  assert.ok(fresh(ada).avatar_id);
});

test('flood control limits rapid posting for members', () => {
  const slow = createForum(db, { floodSeconds: 30 });
  slow.createTopic(fresh(ada), boardSlug, { title: 'First quick topic', body: 'one' });
  assert.throws(() => slow.createTopic(fresh(ada), boardSlug, { title: 'Second quick topic', body: 'two' }), /wait 30 seconds/);
});

test('pagination keeps posts in order and locates a post page', () => {
  const { topicId } = forum.createTopic(fresh(ada), boardSlug, { title: 'Long running thread', body: 'start' });
  let last;
  for (let i = 1; i <= 20; i++) last = forum.reply(fresh(bola), topicId, `reply ${i}`);
  const p2 = forum.topicPosts(topicId, 2);
  assert.equal(p2.pages, 2);
  assert.equal(p2.posts[0].body, 'reply 15'); // post #16 = opening post + 15 replies
  assert.equal(forum.postPage(forum.getPost(last)), 2);
});

test('seed builds a consistent demo forum', () => {
  const sdb = openDb(':memory:');
  const info = seed(sdb);
  const f = createForum(sdb);
  assert.equal(info.topics, 17);
  assert.ok(f.frontPage().length >= 5);
  const sumPosts = sdb.prepare('SELECT SUM(post_count) AS n FROM boards').get().n;
  assert.equal(sumPosts, sdb.prepare('SELECT COUNT(*) AS n FROM posts').get().n);
  assert.equal(f.authenticate('hallkeeper', 'Gisthall#2026').role, 'admin');
});

test('data survives closing and reopening the database file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gisthall-'));
  const file = path.join(dir, 'f.db');
  let d = openDb(file);
  let f = createForum(d);
  const u = f.register({ username: 'persist', email: 'p@x.test', password: 'password123' });
  const s = f.createSection('S');
  f.createBoard({ sectionId: s, name: 'Persist Board' });
  f.createTopic(f.getUserById(u.id), 'persist-board', { title: 'Still here later', body: 'yes' });
  d.close();
  d = openDb(file);
  f = createForum(d);
  assert.equal(f.search('still')[0].title, 'Still here later');
  assert.equal(f.authenticate('persist', 'password123').post_count, 1);
  d.close();
  fs.rmSync(dir, { recursive: true });
});
