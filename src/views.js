// Server-rendered HTML views for Gisthall.
import { esc, renderBody, timeAgo, fmtNum, excerpt } from './lib/format.js';

export const SITE = 'Gisthall';

const LOGO = `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="4" width="36" height="26" rx="8" fill="currentColor"/><path d="M12 30 L10 38 L20 30Z" fill="currentColor"/><circle cx="13" cy="17" r="3" fill="#fff"/><circle cx="20" cy="17" r="3" fill="#fff"/><circle cx="27" cy="17" r="3" fill="#fff"/></svg>`;

const userLink = (name, role) =>
  name
    ? `<a class="user ${role === 'admin' ? 'is-admin' : role === 'mod' ? 'is-mod' : ''}" href="/u/${esc(name)}">${esc(name)}</a>`
    : '<span class="user">[deleted]</span>';

const csrfField = (ctx) => `<input type="hidden" name="_csrf" value="${esc(ctx.csrf || '')}">`;

export const topicUrl = (t, page) => `/t/${t.id ?? t.topic_id}/${esc(t.slug ?? t.topic_slug)}${page > 1 ? `?page=${page}` : ''}`;

function avatar(id, name, size = 48) {
  return id
    ? `<img class="avatar" src="/media/${id}" alt="${esc(name)}" width="${size}" height="${size}" loading="lazy">`
    : `<span class="avatar avatar-fallback" style="width:${size}px;height:${size}px" aria-hidden="true">${esc((name || '?')[0].toUpperCase())}</span>`;
}

export function layout(ctx, { title, body, crumbs = [] }) {
  const u = ctx.user;
  const nav = u
    ? `<a href="/followed">Following</a>
       <a href="/notifications" class="notif-link">Alerts${ctx.unread ? ` <span class="badge" data-testid="unread-badge">${ctx.unread}</span>` : ''}</a>
       ${u.role !== 'member' ? `<a href="/mod/reports">Mod desk</a>` : ''}
       ${u.role === 'admin' ? `<a href="/admin">Admin</a>` : ''}
       <a href="/u/${esc(u.username)}" data-testid="me">${esc(u.username)}</a>
       <form method="post" action="/logout" class="inline">${csrfField(ctx)}<button class="linkish">Log out</button></form>`
    : `<a href="/login">Log in</a> <a href="/register" class="btn btn-sm">Join Gisthall</a>`;
  const trail = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${SITE}</a>${crumbs
        .map(([label, href]) => ` › ${href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`}`)
        .join('')}</nav>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} · ${SITE}` : `${SITE} · Naija's open community forum`)}</title>
<link rel="stylesheet" href="/static/styles.css">
<link rel="icon" href="/static/logo.svg" type="image/svg+xml">
<meta name="csrf" content="${esc(ctx.csrf || '')}">
</head>
<body>
<header class="masthead">
  <div class="wrap masthead-inner">
    <a href="/" class="brand">${LOGO}<span>${SITE}</span></a>
    <form action="/search" method="get" class="top-search" role="search">
      <input type="search" name="q" placeholder="Search topics…" aria-label="Search" value="${esc(ctx.q || '')}">
    </form>
    <nav class="account">${nav}</nav>
  </div>
  <div class="subnav"><div class="wrap">
    <a href="/">Front page</a><a href="/recent">Recent</a><a href="/trending">Trending</a>
    <a href="/boards">All boards</a><a href="/online">Who's online</a><a href="/search">Search</a>
  </div></div>
</header>
<main class="wrap">
${trail}
${ctx.flash ? `<div class="flash flash-${esc(ctx.flash.type)}" role="status">${esc(ctx.flash.text)}</div>` : ''}
${body}
</main>
<footer class="site-foot"><div class="wrap">
  <p><b>${SITE}</b> is a place for Nigerians and friends to gist, argue politely and help each other out.</p>
  <p><a href="/rules">House rules</a> · <a href="/boards">Boards</a> · <a href="/online">Who's online</a></p>
</div></footer>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

export function pager(base, page, pages) {
  if (pages <= 1) return '';
  const sep = base.includes('?') ? '&' : '?';
  const link = (p, label = p) =>
    p === page ? `<span class="current" aria-current="page">${label}</span>` : `<a href="${base}${p > 1 ? `${sep}page=${p}` : ''}">${label}</a>`;
  const items = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) items.push(link(p));
    else if (items[items.length - 1] !== '…') items.push('…');
  }
  return `<nav class="pager" aria-label="Pages">${page > 1 ? link(page - 1, '‹ Prev') : ''}${items.join('')}${
    page < pages ? link(page + 1, 'Next ›') : ''
  }</nav>`;
}

function topicFlags(t) {
  return [
    t.sticky ? '<span class="tag tag-sticky">Pinned</span>' : '',
    t.locked ? '<span class="tag tag-locked">Locked</span>' : '',
    t.featured_at ? '<span class="tag tag-front">Front page</span>' : '',
    t.hidden ? '<span class="tag tag-hidden">Hidden</span>' : '',
  ].join('');
}

export function topicTable(topics, { showBoard = true, empty = 'No topics yet.' } = {}) {
  if (!topics.length) return `<p class="empty">${empty}</p>`;
  return `<table class="topics" data-testid="topic-list">
  <thead><tr><th>Topic</th><th class="num">Replies</th><th class="num">Views</th><th>Last post</th></tr></thead>
  <tbody>${topics
    .map(
      (t) => `<tr${t.sticky ? ' class="is-sticky"' : ''}>
    <td><a class="topic-title" href="${topicUrl(t)}">${esc(t.title)}</a> ${topicFlags(t)}
      <div class="meta">by ${userLink(t.author)}${showBoard ? ` in <a href="/b/${esc(t.board_slug)}">${esc(t.board_name)}</a>` : ''} · ${timeAgo(t.created_at)}</div></td>
    <td class="num">${fmtNum(t.reply_count)}</td>
    <td class="num">${fmtNum(t.views)}</td>
    <td class="meta">${timeAgo(t.last_post_at)}<br>by ${userLink(t.last_poster)}</td>
  </tr>`,
    )
    .join('')}</tbody></table>`;
}

function directoryHtml(sections) {
  return sections
    .map(
      (s) => `<section class="section-card">
  <h2>${esc(s.name)}</h2>
  <ul class="board-list">${s.boards
    .map(
      (b) =>
        `<li><a href="/b/${esc(b.slug)}">${esc(b.name)}</a> <span class="meta">${fmtNum(b.topic_count)} topic${b.topic_count === 1 ? '' : 's'}</span>${
          b.description ? `<div class="board-desc">${esc(b.description)}</div>` : ''
        }</li>`,
    )
    .join('')}</ul></section>`,
    )
    .join('');
}

export function homePage(ctx, { stats, sections, featured, recent }) {
  const body = `
<div class="welcome">
  <p><b>Welcome to ${SITE}.</b> ${ctx.user ? `Good to see you, ${userLink(ctx.user.username, ctx.user.role)}.` : `<a href="/register">Join</a> to start topics, reply and follow members.`}</p>
  <p class="stats" data-testid="stats">${fmtNum(stats.members)} members · ${fmtNum(stats.topics)} topics · ${fmtNum(stats.posts)} posts · <a href="/online">${fmtNum(stats.online)} online now</a>${stats.newest ? ` · Newest: ${userLink(stats.newest)}` : ''}</p>
</div>
<div class="home-grid">
  <div>
    <h1 class="page-title">Front page</h1>
    <p class="hint">Topics picked by moderators for everyone to see.</p>
    <ol class="front-list" data-testid="front-page">${
      featured.length
        ? featured
            .map(
              (t) => `<li><a class="topic-title" href="${topicUrl(t)}">${esc(t.title)}</a>
          <span class="meta">${esc(t.board_name)} · ${fmtNum(t.reply_count)} replies · ${fmtNum(t.views)} views</span></li>`,
            )
            .join('')
        : '<li class="empty">Nothing has been featured yet.</li>'
    }</ol>
    <h2 class="page-title">Fresh gist</h2>
    ${topicTable(recent)}
    <p><a href="/recent">More recent topics ›</a></p>
  </div>
  <aside class="directory" aria-label="Boards">${directoryHtml(sections)}</aside>
</div>`;
  return layout(ctx, { body });
}

export function boardsPage(ctx, sections) {
  return layout(ctx, {
    title: 'All boards',
    crumbs: [['All boards']],
    body: `<h1 class="page-title">All boards</h1><div class="directory directory-wide">${directoryHtml(sections)}</div>`,
  });
}

export function boardPage(ctx, { board, list, page, following, isMod }) {
  const actions = ctx.user
    ? `<a class="btn" href="/b/${esc(board.slug)}/new" data-testid="new-topic">Start a topic</a>
       <form method="post" action="/b/${esc(board.slug)}/follow" class="inline">${csrfField(ctx)}
         <button class="btn btn-ghost" data-testid="follow-board">${following ? 'Unfollow board' : 'Follow board'}</button></form>`
    : `<a class="btn" href="/login?next=/b/${esc(board.slug)}/new">Log in to start a topic</a>`;
  const crumbs = [[board.section_name, '/boards']];
  if (board.parent) crumbs.push([board.parent.name, `/b/${board.parent.slug}`]);
  crumbs.push([board.name]);
  return layout(ctx, {
    title: board.name,
    crumbs,
    body: `
<div class="board-head">
  <div><h1 class="page-title">${esc(board.name)}</h1>
  ${board.description ? `<p class="hint">${esc(board.description)}</p>` : ''}
  <p class="meta">${fmtNum(board.topic_count)} topics · ${fmtNum(board.post_count)} posts${
    board.mods.length ? ` · Moderated by ${board.mods.map((m) => userLink(m.username, 'mod')).join(', ')}` : ''
  }</p></div>
  <div class="actions">${actions}</div>
</div>
${board.children.length ? `<p class="child-boards">Child boards: ${board.children.map((c) => `<a href="/b/${esc(c.slug)}">${esc(c.name)}</a>`).join(' · ')}</p>` : ''}
<form action="/search" class="board-search"><input type="hidden" name="board" value="${esc(board.slug)}">
  <input type="search" name="q" placeholder="Search this board" aria-label="Search this board"><button class="btn btn-ghost">Search</button></form>
${topicTable(list.topics, { showBoard: false, empty: 'No topics here yet. Be the first to start one.' })}
${pager(`/b/${esc(board.slug)}`, page, list.pages)}
${isMod ? '<p class="hint">You moderate this board. Hidden topics are shown to you.</p>' : ''}`,
  });
}

function postActions(ctx, post, topic, canMod) {
  if (post.hidden && !canMod) return '';
  const u = ctx.user;
  const parts = [];
  if (u) {
    parts.push(
      `<form method="post" action="/p/${post.id}/like" class="inline js-toggle">${csrfField(ctx)}<button class="act${post.liked ? ' on' : ''}" data-testid="like-${post.id}" aria-pressed="${post.liked}">${post.liked ? 'Liked' : 'Like'} <span class="count">${post.like_count}</span></button></form>`,
      `<form method="post" action="/p/${post.id}/share" class="inline js-toggle">${csrfField(ctx)}<button class="act${post.shared ? ' on' : ''}" data-testid="share-${post.id}" aria-pressed="${post.shared}">${post.shared ? 'Shared' : 'Share'} <span class="count">${post.share_count}</span></button></form>`,
    );
    if (!topic.locked || canMod) parts.push(`<a class="act" href="${topicUrl(topic)}?quote=${post.id}#reply" data-testid="quote-${post.id}">Quote</a>`);
    if (u.id === post.user_id || canMod) parts.push(`<a class="act" href="/p/${post.id}/edit" data-testid="edit-${post.id}">Edit</a>`);
    if (u.id !== post.user_id) parts.push(`<a class="act" href="/p/${post.id}/report" data-testid="report-${post.id}">Report</a>`);
    if (canMod)
      parts.push(
        `<form method="post" action="/p/${post.id}/${post.hidden ? 'unhide' : 'hide'}" class="inline">${csrfField(ctx)}<button class="act act-mod" data-testid="hide-${post.id}">${post.hidden ? 'Unhide' : 'Hide'}</button></form>`,
      );
  } else {
    parts.push(`<span class="meta">${post.like_count} likes · ${post.share_count} shares</span>`);
  }
  return `<div class="post-actions">${parts.join('')}</div>`;
}

export function postHtml(ctx, post, topic, canMod, { index } = {}) {
  const hiddenNote = post.hidden ? '<div class="hidden-note">This post was hidden by a moderator.</div>' : '';
  const content =
    post.hidden && !canMod
      ? ''
      : `<div class="post-body">${renderBody(post.body)}</div>
    ${post.attachments?.length ? `<div class="attachments">${post.attachments.map((a) => `<a href="/media/${a.id}" target="_blank"><img src="/media/${a.id}" alt="Attached image" loading="lazy"></a>`).join('')}</div>` : ''}
    ${post.edited_at ? `<div class="edited meta">Edited ${timeAgo(post.edited_at)}${post.edit_count > 1 ? ` (${post.edit_count} times)` : ''} · <a href="/p/${post.id}/history">history</a></div>` : ''}
    ${post.signature ? `<div class="signature">${esc(post.signature)}</div>` : ''}`;
  return `<article class="post${post.hidden ? ' is-hidden' : ''}" id="p${post.id}" data-testid="post-${post.id}">
  <div class="post-author">${avatar(post.avatar_id, post.username)}
    <div>${userLink(post.username, post.role)}${post.role !== 'member' ? `<span class="role-tag">${post.role === 'admin' ? 'Admin' : 'Mod'}</span>` : ''}
    <div class="meta">${fmtNum(post.author_posts)} posts${post.location ? ` · ${esc(post.location)}` : ''}</div></div>
  </div>
  <div class="post-main">
    <div class="post-head meta"><a href="/p/${post.id}">#${index ?? post.id}</a> · ${timeAgo(post.created_at)}</div>
    ${hiddenNote}${content}
    ${postActions(ctx, post, topic, canMod)}
  </div>
</article>`;
}

export function topicPage(ctx, { topic, list, page, canMod, following, quoteText, boards }) {
  const startIndex = (page - 1) * 15;
  const modBar = canMod
    ? `<div class="mod-bar" data-testid="mod-bar"><b>Moderate:</b>
      ${[
        ['sticky', topic.sticky, 'Pin', 'Unpin'],
        ['locked', topic.locked, 'Lock', 'Unlock'],
        ['featured', topic.featured_at, 'Feature on front page', 'Remove from front page'],
        ['hidden', topic.hidden, 'Hide topic', 'Unhide topic'],
      ]
        .map(
          ([flag, on, a, b]) =>
            `<form method="post" action="/t/${topic.id}/mod" class="inline">${csrfField(ctx)}<input type="hidden" name="flag" value="${flag}"><input type="hidden" name="value" value="${on ? 0 : 1}"><button class="btn btn-sm btn-ghost" data-testid="mod-${flag}">${on ? b : a}</button></form>`,
        )
        .join('')}
      <form method="post" action="/t/${topic.id}/move" class="inline">${csrfField(ctx)}
        <select name="board" aria-label="Move to board">${boards.map((b) => `<option value="${esc(b.slug)}"${b.id === topic.board_id ? ' selected' : ''}>${esc(b.section_name)} › ${esc(b.name)}</option>`).join('')}</select>
        <button class="btn btn-sm btn-ghost" data-testid="mod-move">Move</button></form>
    </div>`
    : '';
  let replyBox;
  if (!ctx.user) replyBox = `<p class="reply-login"><a href="/login?next=${encodeURIComponent(topicUrl(topic))}">Log in</a> or <a href="/register">join</a> to reply.</p>`;
  else if (topic.locked && !canMod) replyBox = '<p class="hint">This topic is locked. New replies are closed.</p>';
  else
    replyBox = `<form method="post" action="/t/${topic.id}/reply" enctype="multipart/form-data" class="reply-form card" id="reply">
    ${csrfField(ctx)}
    <label for="reply-body"><b>Your reply</b></label>
    <textarea id="reply-body" name="body" rows="7" required minlength="2" placeholder="Add to the gist… Use @username to mention someone.">${esc(quoteText || '')}</textarea>
    <div class="form-row"><label>Attach images <input type="file" name="images" accept="image/png,image/jpeg,image/gif,image/webp" multiple></label>
    <button class="btn" data-testid="submit-reply">Post reply</button></div>
    <p class="hint">Formatting: [b]bold[/b], [i]italic[/i], [quote]…[/quote], links are automatic.</p>
  </form>`;
  return layout(ctx, {
    title: topic.title,
    crumbs: [[topic.board_name, `/b/${topic.board_slug}`], [topic.title]],
    body: `
<div class="topic-head">
  <h1 class="page-title" data-testid="topic-title">${esc(topic.title)} ${topicFlags(topic)}</h1>
  <p class="meta">Started by ${userLink(topic.author)} ${timeAgo(topic.created_at)} · <span data-testid="views">${fmtNum(topic.views)} views</span> · ${fmtNum(topic.reply_count)} replies</p>
  ${ctx.user ? `<form method="post" action="/t/${topic.id}/follow" class="inline">${csrfField(ctx)}<button class="btn btn-sm btn-ghost" data-testid="follow-topic">${following ? 'Unfollow topic' : 'Follow topic'}</button></form>` : ''}
</div>
${modBar}
${pager(topicUrl(topic), page, list.pages)}
<div class="posts">${list.posts.map((p, i) => postHtml(ctx, p, topic, canMod, { index: startIndex + i + 1 })).join('')}</div>
${pager(topicUrl(topic), page, list.pages)}
${replyBox}`,
  });
}

export function newTopicPage(ctx, { board, values = {} }) {
  return layout(ctx, {
    title: `New topic in ${board.name}`,
    crumbs: [[board.name, `/b/${board.slug}`], ['New topic']],
    body: `<h1 class="page-title">Start a topic in ${esc(board.name)}</h1>
<form method="post" action="/b/${esc(board.slug)}/new" enctype="multipart/form-data" class="card form-stack">
  ${csrfField(ctx)}
  <label>Title <input name="title" required minlength="5" maxlength="150" value="${esc(values.title || '')}"></label>
  <label>Post <textarea name="body" rows="10" required minlength="2">${esc(values.body || '')}</textarea></label>
  <label>Attach images <input type="file" name="images" accept="image/png,image/jpeg,image/gif,image/webp" multiple></label>
  <button class="btn" data-testid="submit-topic">Create topic</button>
</form>`,
  });
}

export function editPostPage(ctx, { post, isFirst }) {
  return layout(ctx, {
    title: 'Edit post',
    crumbs: [[post.topic_title, `/t/${post.topic_id}/${post.topic_slug}`], ['Edit post']],
    body: `<h1 class="page-title">Edit post</h1>
<form method="post" action="/p/${post.id}/edit" class="card form-stack">
  ${csrfField(ctx)}
  ${isFirst ? `<label>Topic title <input name="title" required minlength="5" maxlength="150" value="${esc(post.topic_title)}"></label>` : ''}
  <label>Post <textarea name="body" rows="10" required>${esc(post.body)}</textarea></label>
  <button class="btn" data-testid="save-edit">Save changes</button>
</form>`,
  });
}

export function historyPage(ctx, { post, edits }) {
  return layout(ctx, {
    title: 'Edit history',
    crumbs: [[post.topic_title, `/p/${post.id}`], ['Edit history']],
    body: `<h1 class="page-title">Edit history</h1>
<div class="card"><h3>Current</h3><div class="post-body">${renderBody(post.body)}</div></div>
${edits.map((e) => `<div class="card"><h3 class="meta">Before edit by ${userLink(e.editor)} · ${timeAgo(e.edited_at)}</h3><div class="post-body">${renderBody(e.old_body)}</div></div>`).join('')}`,
  });
}

export function reportPage(ctx, { post }) {
  return layout(ctx, {
    title: 'Report post',
    crumbs: [[post.topic_title, `/p/${post.id}`], ['Report']],
    body: `<h1 class="page-title">Report a post</h1>
<div class="card"><p class="meta">Post by ${userLink(post.username)}</p><div class="post-body">${renderBody(excerpt(post.body, 400))}</div></div>
<form method="post" action="/p/${post.id}/report" class="card form-stack">${csrfField(ctx)}
  <label>What's wrong with it? <textarea name="reason" rows="4" required minlength="3" placeholder="Spam, insults, scam, wrong board…"></textarea></label>
  <button class="btn" data-testid="submit-report">Send to moderators</button>
</form>`,
  });
}

export function authPage(ctx, { mode, values = {}, next = '' }) {
  const isLogin = mode === 'login';
  return layout(ctx, {
    title: isLogin ? 'Log in' : 'Join',
    body: `<div class="auth card">
<h1 class="page-title">${isLogin ? 'Log in' : `Join ${SITE}`}</h1>
<form method="post" action="/${mode}" class="form-stack">
  ${csrfField(ctx)}<input type="hidden" name="next" value="${esc(next)}">
  ${isLogin
    ? `<label>Username or email <input name="login" required autocomplete="username" value="${esc(values.login || '')}"></label>`
    : `<label>Username <input name="username" required pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" value="${esc(values.username || '')}"></label>
       <label>Email <input name="email" type="email" required autocomplete="email" value="${esc(values.email || '')}"></label>`}
  <label>Password <input name="password" type="password" required ${isLogin ? '' : 'minlength="8"'} autocomplete="${isLogin ? 'current-password' : 'new-password'}"></label>
  <button class="btn" data-testid="${mode}-submit">${isLogin ? 'Log in' : 'Create account'}</button>
</form>
<p class="hint">${isLogin ? `New here? <a href="/register">Create an account</a>.` : `Already a member? <a href="/login">Log in</a>.`}</p>
</div>`,
  });
}

export function profilePage(ctx, { user, tab, topics, posts, isFollowing, isMe, banned }) {
  const u = user;
  const followBtn =
    ctx.user && !isMe
      ? `<form method="post" action="/u/${esc(u.username)}/follow" class="inline">${csrfField(ctx)}<button class="btn btn-sm" data-testid="follow-user">${isFollowing ? 'Unfollow' : 'Follow'}</button></form>`
      : '';
  const staffTools =
    ctx.user && ctx.user.role !== 'member' && !isMe && u.role !== 'admin'
      ? `<details class="card staff-tools"><summary>Moderator tools</summary>
      ${banned
        ? `<form method="post" action="/u/${esc(u.username)}/unban" class="inline">${csrfField(ctx)}<button class="btn btn-sm" data-testid="unban">Lift ban</button></form>`
        : `<form method="post" action="/u/${esc(u.username)}/ban" class="form-row">${csrfField(ctx)}
          <label>Days <input type="number" name="days" min="1" max="3650" value="7" style="width:5em"></label>
          <label>Reason <input name="reason" required></label><button class="btn btn-sm btn-danger" data-testid="ban">Ban</button></form>`}
    </details>`
      : '';
  const tabs = ['topics', 'posts']
    .map((t) => `<a href="/u/${esc(u.username)}?tab=${t}" class="${tab === t ? 'active' : ''}">${t === 'topics' ? 'Topics' : 'Posts'}</a>`)
    .join('');
  const listing =
    tab === 'posts'
      ? posts.length
        ? posts.map((p) => `<div class="card mini-post"><div class="meta">In <a href="/p/${p.id}">${esc(p.topic_title)}</a> · ${timeAgo(p.created_at)}</div>${p.hidden ? '<em class="meta">Hidden by a moderator.</em>' : `<div class="post-body">${renderBody(p.body)}</div>`}</div>`).join('')
        : '<p class="empty">No posts yet.</p>'
      : topicTable(topics, { empty: 'No topics yet.' });
  return layout(ctx, {
    title: u.username,
    crumbs: [['Members'], [u.username]],
    body: `<div class="profile card">
  ${avatar(u.avatar_id, u.username, 96)}
  <div class="profile-info">
    <h1 class="page-title" data-testid="profile-name">${esc(u.username)} ${u.role !== 'member' ? `<span class="role-tag">${u.role === 'admin' ? 'Admin' : 'Mod'}</span>` : ''}</h1>
    ${banned ? `<p class="flash flash-error">Banned until ${esc(u.banned_until)} UTC.</p>` : ''}
    ${u.bio ? `<p class="bio" data-testid="profile-bio">${esc(u.bio)}</p>` : ''}
    <ul class="facts">
      ${u.location ? `<li>Location: <b data-testid="profile-location">${esc(u.location)}</b></li>` : ''}
      ${u.gender ? `<li>Gender: ${esc(u.gender)}</li>` : ''}
      <li>Joined ${timeAgo(u.created_at)}</li><li>Last seen ${timeAgo(u.last_seen)}</li>
      <li>${fmtNum(u.post_count)} posts · ${fmtNum(u.topic_count)} topics · <span data-testid="likes-received">${fmtNum(u.likes_received)}</span> likes received</li>
      <li><a href="/u/${esc(u.username)}/followers" data-testid="followers-count">${fmtNum(u.followers)} followers</a> · <a href="/u/${esc(u.username)}/following">${fmtNum(u.following)} following</a></li>
      ${u.mod_boards.length ? `<li>Moderates: ${u.mod_boards.map((b) => `<a href="/b/${esc(b.slug)}">${esc(b.name)}</a>`).join(', ')}</li>` : ''}
    </ul>
    <p>${followBtn} ${isMe ? '<a class="btn btn-sm btn-ghost" href="/settings">Edit profile</a>' : ''}</p>
  </div>
</div>
${staffTools}
<nav class="tabs">${tabs}</nav>
${listing}`,
  });
}

export function peoplePage(ctx, { user, kind, people }) {
  return layout(ctx, {
    title: `${user.username}'s ${kind}`,
    crumbs: [[user.username, `/u/${user.username}`], [kind]],
    body: `<h1 class="page-title">${esc(user.username)}'s ${kind}</h1>
<ul class="people" data-testid="people">${people.length ? people.map((p) => `<li>${avatar(p.avatar_id, p.username, 32)} ${userLink(p.username)}</li>`).join('') : '<li class="empty">Nobody yet.</li>'}</ul>`,
  });
}

export function settingsPage(ctx, { user }) {
  const g = (v) => (user.gender === v ? ' selected' : '');
  return layout(ctx, {
    title: 'Settings',
    crumbs: [[user.username, `/u/${user.username}`], ['Settings']],
    body: `<h1 class="page-title">Profile settings</h1>
<form method="post" action="/settings" class="card form-stack">${csrfField(ctx)}
  <label>About you <textarea name="bio" rows="4" maxlength="1000">${esc(user.bio)}</textarea></label>
  <label>Location <input name="location" maxlength="80" value="${esc(user.location)}"></label>
  <label>Gender <select name="gender"><option value="">Prefer not to say</option><option value="female"${g('female')}>Female</option><option value="male"${g('male')}>Male</option><option value="other"${g('other')}>Other</option></select></label>
  <label>Signature <input name="signature" maxlength="200" value="${esc(user.signature)}"></label>
  <button class="btn" data-testid="save-profile">Save profile</button>
</form>
<form method="post" action="/settings/avatar" enctype="multipart/form-data" class="card form-stack">${csrfField(ctx)}
  <div class="form-row">${avatar(user.avatar_id, user.username, 64)}<label>New photo (PNG, JPEG, GIF or WebP, max 2 MB) <input type="file" name="avatar" required accept="image/png,image/jpeg,image/gif,image/webp"></label></div>
  <button class="btn" data-testid="save-avatar">Upload photo</button>
</form>
<form method="post" action="/settings/password" class="card form-stack">${csrfField(ctx)}
  <label>Current password <input type="password" name="current" required autocomplete="current-password"></label>
  <label>New password <input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
  <button class="btn" data-testid="save-password">Change password</button>
  <p class="hint">Changing your password logs you out everywhere.</p>
</form>`,
  });
}

const NOTE_TEXT = {
  reply: 'replied to',
  quote: 'quoted you in',
  mention: 'mentioned you in',
  like: 'liked your post in',
  share: 'shared your post in',
  new_topic: 'started a new topic:',
  follow: 'started following you',
  post_hidden: 'hid your post in',
};

export function notificationsPage(ctx, { items }) {
  return layout(ctx, {
    title: 'Alerts',
    crumbs: [['Alerts']],
    body: `<h1 class="page-title">Alerts</h1>
<ul class="notes" data-testid="notifications">${
      items.length
        ? items
            .map(
              (n) => `<li class="${n.read_at ? '' : 'unread'}" data-kind="${esc(n.kind)}">${userLink(n.actor)} ${NOTE_TEXT[n.kind] || n.kind} ${
                n.topic_id ? `<a href="${n.post_id ? `/p/${n.post_id}` : `/t/${n.topic_id}/${esc(n.topic_slug)}`}">${esc(n.topic_title)}</a>` : ''
              } <span class="meta">${timeAgo(n.created_at)}</span></li>`,
            )
            .join('')
        : '<li class="empty">No alerts yet.</li>'
    }</ul>`,
  });
}

export function listingPage(ctx, { title, hint, list, page, base, crumbs }) {
  return layout(ctx, {
    title,
    crumbs: crumbs || [[title]],
    body: `<h1 class="page-title">${esc(title)}</h1>${hint ? `<p class="hint">${hint}</p>` : ''}
${topicTable(list.topics)}${list.pages ? pager(base, page, list.pages) : ''}`,
  });
}

export function searchPage(ctx, { q, type, board, results, boards }) {
  const rows =
    type === 'posts'
      ? results.length
        ? results.map((r) => `<div class="card mini-post"><div class="meta">${userLink(r.username)} in <a href="/p/${r.id}">${esc(r.topic_title)}</a> (${esc(r.board_name)}) · ${timeAgo(r.created_at)}</div><p>${esc(excerpt(r.body, 260))}</p></div>`).join('')
        : `<p class="empty">No posts matched.</p>`
      : topicTable(results, { empty: 'No topics matched.' });
  return layout(ctx, {
    title: q ? `Search: ${q}` : 'Search',
    crumbs: [['Search']],
    body: `<h1 class="page-title">Search</h1>
<form action="/search" class="card form-row search-form" role="search">
  <input type="search" name="q" value="${esc(q)}" placeholder="What are you looking for?" aria-label="Search terms" required>
  <select name="type" aria-label="Search in"><option value="topics"${type === 'topics' ? ' selected' : ''}>Topic titles</option><option value="posts"${type === 'posts' ? ' selected' : ''}>Post text</option></select>
  <select name="board" aria-label="Board"><option value="">All boards</option>${boards.map((b) => `<option value="${esc(b.slug)}"${b.slug === board ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
  <button class="btn" data-testid="search-submit">Search</button>
</form>
${q ? `<div data-testid="search-results">${rows}</div>` : ''}`,
  });
}

export function onlinePage(ctx, { users }) {
  return layout(ctx, {
    title: "Who's online",
    crumbs: [["Who's online"]],
    body: `<h1 class="page-title">Who's online</h1><p class="hint">Members active in the last 15 minutes.</p>
<ul class="people" data-testid="online-list">${users.length ? users.map((u) => `<li>${userLink(u.username, u.role)} <span class="meta">${timeAgo(u.last_seen)}</span></li>`).join('') : '<li class="empty">Nobody right now.</li>'}</ul>`,
  });
}

export function reportsPage(ctx, { reports }) {
  return layout(ctx, {
    title: 'Mod desk',
    crumbs: [['Mod desk']],
    body: `<h1 class="page-title">Mod desk</h1><p><a href="/mod/log">Moderation log ›</a></p>
<h2>Open reports</h2>
<div data-testid="reports">${
      reports.length
        ? reports
            .map(
              (r) => `<div class="card report">
  <p class="meta">${userLink(r.reporter)} reported a post by ${userLink(r.author)} in <a href="/p/${r.post_id}">${esc(r.topic_title)}</a> · ${timeAgo(r.created_at)}</p>
  <p><b>Reason:</b> ${esc(r.reason)}</p>
  <blockquote class="quote">${esc(excerpt(r.body, 300))}</blockquote>
  <div class="form-row">
    ${r.post_hidden ? '' : `<form method="post" action="/p/${r.post_id}/hide" class="inline">${csrfField(ctx)}<input type="hidden" name="next" value="/mod/reports"><button class="btn btn-sm btn-danger" data-testid="report-hide-${r.id}">Hide post</button></form>`}
    <form method="post" action="/mod/reports/${r.id}" class="inline">${csrfField(ctx)}<input type="hidden" name="status" value="resolved"><button class="btn btn-sm" data-testid="report-resolve-${r.id}">Mark resolved</button></form>
    <form method="post" action="/mod/reports/${r.id}" class="inline">${csrfField(ctx)}<input type="hidden" name="status" value="dismissed"><button class="btn btn-sm btn-ghost" data-testid="report-dismiss-${r.id}">Dismiss</button></form>
  </div></div>`,
            )
            .join('')
        : '<p class="empty">No open reports. Nice and quiet.</p>'
    }</div>`,
  });
}

export function modLogPage(ctx, { entries }) {
  return layout(ctx, {
    title: 'Moderation log',
    crumbs: [['Mod desk', '/mod/reports'], ['Log']],
    body: `<h1 class="page-title">Moderation log</h1>
<table class="topics" data-testid="mod-log"><thead><tr><th>When</th><th>Moderator</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
${entries.map((e) => `<tr><td class="meta">${timeAgo(e.created_at)}</td><td>${userLink(e.mod)}</td><td>${esc(e.action)}</td><td>${esc(e.target_type)} #${e.target_id}</td><td>${esc(e.detail)}</td></tr>`).join('')}
</tbody></table>`,
  });
}

export function adminPage(ctx, { sections, boards, staff }) {
  return layout(ctx, {
    title: 'Admin',
    crumbs: [['Admin']],
    body: `<h1 class="page-title">Admin</h1>
<div class="admin-grid">
<form method="post" action="/admin/sections" class="card form-stack">${csrfField(ctx)}<h2>New section</h2>
  <label>Name <input name="name" required></label><button class="btn" data-testid="create-section">Add section</button></form>
<form method="post" action="/admin/boards" class="card form-stack">${csrfField(ctx)}<h2>New board</h2>
  <label>Section <select name="section_id">${sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
  <label>Parent board (optional) <select name="parent_id"><option value="">None</option>${boards.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
  <label>Name <input name="name" required></label>
  <label>Description <input name="description"></label>
  <button class="btn" data-testid="create-board">Add board</button></form>
<form method="post" action="/admin/mods" class="card form-stack">${csrfField(ctx)}<h2>Board moderators</h2>
  <label>Board <select name="board">${boards.map((b) => `<option value="${esc(b.slug)}">${esc(b.name)}</option>`).join('')}</select></label>
  <label>Username <input name="username" required></label>
  <label><input type="radio" name="assign" value="1" checked> Assign</label><label><input type="radio" name="assign" value="0"> Remove</label>
  <button class="btn" data-testid="assign-mod">Save</button></form>
<form method="post" action="/admin/roles" class="card form-stack">${csrfField(ctx)}<h2>Member role</h2>
  <label>Username <input name="username" required></label>
  <label>Role <select name="role"><option value="member">Member</option><option value="mod">Moderator</option><option value="admin">Admin</option></select></label>
  <button class="btn" data-testid="set-role">Update role</button></form>
</div>
<h2>Staff</h2><ul class="people">${staff.map((s) => `<li>${userLink(s.username, s.role)} <span class="meta">${s.role}</span></li>`).join('')}</ul>`,
  });
}

export function rulesPage(ctx) {
  return layout(ctx, {
    title: 'House rules',
    crumbs: [['House rules']],
    body: `<h1 class="page-title">House rules</h1><div class="card prose">
<ol>
<li>Be respectful. Argue with ideas, not with people's families or tribes.</li>
<li>No scams, fake giveaways or "send me your BVN" nonsense. We ban on sight.</li>
<li>Post in the right board. Moderators may move topics that wander.</li>
<li>No hate speech, threats or sharing other people's private details.</li>
<li>Don't spam the same link or topic across boards.</li>
<li>Use Report for problems instead of fighting in the thread.</li>
</ol></div>`,
  });
}

export function errorPage(ctx, status, message) {
  return layout(ctx, {
    title: `Error ${status}`,
    body: `<div class="card error-card"><h1 class="page-title">${status === 404 ? 'Not found' : 'Something went wrong'}</h1><p data-testid="error-message">${esc(message)}</p><p><a href="/">Back to the front page</a></p></div>`,
  });
}
