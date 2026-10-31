import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, slugify, renderBody, extractMentions, extractQuotedPostIds, excerpt, timeAgo } from '../../src/lib/format.js';

test('esc escapes HTML special characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('Money & Business'), 'money-business');
  assert.equal(slugify('  Héllo,   World!! '), 'hello-world');
  assert.equal(slugify('!!!'), 'topic');
});

test('renderBody never lets raw HTML through', () => {
  const html = renderBody('<script>alert(1)</script> [b]bold[/b]');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('renderBody renders nested quotes with author links', () => {
  const html = renderBody('[quote author=amaka post=7]outer [quote author=bayo post=3]inner[/quote][/quote]\nreply');
  assert.equal((html.match(/<blockquote/g) || []).length, 2);
  assert.ok(html.includes('<a href="/p/7"><b>amaka</b> said</a>'));
  assert.ok(html.includes('<a href="/p/3"><b>bayo</b> said</a>'));
});

test('renderBody balances unterminated quotes and escapes stray closers', () => {
  assert.equal((renderBody('[quote]never closed').match(/<\/blockquote>/g) || []).length, 1);
  assert.ok(renderBody('oops [/quote]').includes('[/quote]'));
});

test('renderBody auto-links URLs and mentions, rejects javascript: urls', () => {
  const html = renderBody('see https://example.com and ping @dami_codes [url=javascript:alert(1)]x[/url]');
  assert.ok(html.includes('<a href="https://example.com"'));
  assert.ok(html.includes('<a class="mention" href="/u/dami_codes">@dami_codes</a>'));
  assert.ok(!html.includes('href="javascript:'));
});

test('extractMentions ignores quoted text and emails', () => {
  const body = '[quote author=x post=1]hi @quoted_user[/quote] hello @Real_User and mail me at me@example.com';
  assert.deepEqual(extractMentions(body), ['real_user']);
});

test('extractQuotedPostIds finds quoted posts', () => {
  assert.deepEqual(extractQuotedPostIds('[quote author=a post=4]x[/quote][quote post=9]y[/quote]'), [4, 9]);
});

test('excerpt strips markup and truncates', () => {
  const text = excerpt(`[quote]old[/quote] [b]${'word '.repeat(60)}[/b]`, 50);
  assert.ok(!text.includes('old') && !text.includes('[b]'));
  assert.equal(text.length, 50);
});

test('timeAgo formats relative time', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.equal(timeAgo('2026-10-31 11:59:30', now), 'just now');
  assert.equal(timeAgo('2026-10-31 11:00:00', now), '1 hr ago');
  assert.equal(timeAgo('2026-10-29 12:00:00', now), '2 days ago');
});
