// Post formatting: posts are stored as plain text with a tiny tag language
// ([quote], [b], [i], [url]) plus auto-linked URLs and @mentions.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'topic'
  );
}

const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_]{3,20})\b/g;

/** Usernames mentioned in a body, excluding text inside [quote] blocks. */
export function extractMentions(body) {
  const outside = stripQuotes(body);
  const names = new Set();
  for (const m of outside.matchAll(MENTION_RE)) names.add(m[2].toLowerCase());
  return [...names];
}

/** Post ids referenced by top-level [quote post=N] tags. */
export function extractQuotedPostIds(body) {
  const ids = new Set();
  for (const m of String(body).matchAll(/\[quote[^\]]*\bpost=(\d+)[^\]]*\]/gi)) ids.add(Number(m[1]));
  return [...ids];
}

export function stripQuotes(body) {
  let text = String(body);
  let prev;
  do {
    prev = text;
    text = text.replace(/\[quote[^\]]*\](?:(?!\[quote)[\s\S])*?\[\/quote\]/gi, ' ');
  } while (text !== prev);
  return text;
}

function inline(text) {
  let html = esc(text);
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  html = html.replace(
    /\[url=(https?:\/\/[^\]\s]+)\]([\s\S]*?)\[\/url\]/gi,
    (_, href, label) => `<a href="${href}" rel="nofollow ugc noopener" target="_blank">${label}</a>`,
  );
  // Auto-link bare URLs that are not already inside an attribute.
  html = html.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) => `${pre}<a href="${url}" rel="nofollow ugc noopener" target="_blank">${url}</a>`,
  );
  html = html.replace(
    MENTION_RE,
    (_, pre, name) => `${pre}<a class="mention" href="/u/${name}">@${name}</a>`,
  );
  return html.replace(/\r?\n/g, '<br>');
}

/** Render a post body to safe HTML. */
export function renderBody(body) {
  const src = String(body ?? '');
  const out = [];
  const stack = [];
  const tagRe = /\[quote([^\]]*)\]|\[\/quote\]/gi;
  let last = 0;
  let m;
  const push = (html) => (stack.length ? stack[stack.length - 1].parts : out).push(html);
  while ((m = tagRe.exec(src))) {
    push(inline(src.slice(last, m.index)));
    last = tagRe.lastIndex;
    if (m[0][1] !== '/') {
      const attrs = m[1] || '';
      const author = (attrs.match(/author=([A-Za-z0-9_]{1,20})/i) || [])[1];
      const post = (attrs.match(/post=(\d+)/i) || [])[1];
      stack.push({ author, post, parts: [] });
    } else if (stack.length) {
      const q = stack.pop();
      const head = q.author
        ? `<div class="quote-head">${
            q.post ? `<a href="/p/${q.post}">` : ''
          }<b>${esc(q.author)}</b> said${q.post ? '</a>' : ''}:</div>`
        : '';
      push(`<blockquote class="quote">${head}${q.parts.join('').replace(/^(<br>)+|(<br>)+$/g, '')}</blockquote>`);
    } else {
      push(esc(m[0]));
    }
  }
  push(inline(src.slice(last)));
  // Close any unterminated quotes so markup stays balanced.
  while (stack.length) {
    const q = stack.pop();
    push(`<blockquote class="quote">${q.parts.join('')}</blockquote>`);
  }
  return out.join('');
}

export function excerpt(body, len = 180) {
  const text = stripQuotes(body)
    .replace(/\[\/?(b|i|url[^\]]*)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? `${text.slice(0, len - 1)}…` : text;
}

export function timeAgo(sqlTime, now = Date.now()) {
  if (!sqlTime) return '';
  const t = Date.parse(`${sqlTime.replace(' ', 'T')}Z`);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const units = [
    [60, 'min'],
    [60, 'hr'],
    [24, 'day'],
    [7, 'wk'],
  ];
  let v = s / 60;
  let label = 'min';
  for (let i = 1; i < units.length && v >= units[i][0]; i++) {
    v /= units[i][0];
    label = units[i][1];
  }
  if (label === 'wk' && v >= 5) {
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const n = Math.floor(v);
  return `${n} ${label}${n === 1 ? '' : 's'} ago`;
}

export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
