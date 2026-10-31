// Progressive enhancement: like/share toggles without a page reload.
// Every form still works without JavaScript.
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.classList.contains('js-toggle')) return;
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    const { active, count } = await res.json();
    const isLike = form.action.endsWith('/like');
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
    button.firstChild.textContent = `${isLike ? (active ? 'Liked' : 'Like') : active ? 'Shared' : 'Share'} `;
    button.querySelector('.count').textContent = count;
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});
