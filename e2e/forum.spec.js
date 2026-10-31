import { test, expect } from '@playwright/test';
import { ADMIN, PASSWORD, register, login, logout, createTopic, reply, lastPostId, asNewUser, uniqueName } from './helpers.js';

test.describe('browsing as a guest', () => {
  test('home shows stats, front page, fresh topics and the board directory', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Gisthall/);
    await expect(page.getByTestId('stats')).toContainText('members');
    await expect(page.getByTestId('front-page').locator('li')).not.toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fresh gist' })).toBeVisible();
    await page.getByRole('link', { name: 'Tech Corner' }).first().click();
    await expect(page.getByRole('heading', { name: 'Tech Corner' })).toBeVisible();
    await expect(page.getByTestId('topic-list')).toContainText('programming language');
    await expect(page.getByRole('link', { name: 'Log in to start a topic' })).toBeVisible();
  });

  test('topic pages render posts, quotes and count views', async ({ page }) => {
    await page.goto('/b/football');
    await page.getByRole('link', { name: /Super Eagles/ }).click();
    const views = Number((await page.getByTestId('views').innerText()).replace(/\D/g, ''));
    await expect(page.locator('blockquote.quote').first()).toContainText('musa_motors said');
    await page.reload();
    await expect(page.getByTestId('views')).toContainText(String(views + 1));
    await expect(page.getByText('Log in or join to reply.')).toBeVisible();
  });

  test('navigation pages: boards, recent, trending, online, rules, search, 404', async ({ page }) => {
    for (const [link, heading] of [
      ['All boards', 'All boards'],
      ['Recent', 'Recent topics'],
      ['Trending', 'Trending'],
      ["Who's online", "Who's online"],
    ]) {
      await page.goto('/');
      await page.locator('.subnav').getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.getByRole('link', { name: 'House rules' }).click();
    await expect(page.getByRole('heading', { name: 'House rules' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('visa checklist');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-results')).toContainText('My visa application checklist');
    await page.goto('/search?q=diesel&type=posts');
    await expect(page.getByTestId('search-results')).toContainText('Solar for the shop');
    const res = await page.goto('/does-not-exist');
    expect(res.status()).toBe(404);
    await expect(page.getByTestId('error-message')).toHaveText('That page does not exist.');
  });
});

test.describe('accounts', () => {
  test('register, log out, reject a wrong password, log back in', async ({ page }) => {
    const name = await register(page);
    await expect(page.locator('.flash')).toContainText(`Welcome to Gisthall, ${name}`);
    await logout(page);
    await page.goto('/login');
    await page.getByLabel('Username or email').fill(name);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.locator('.flash-error')).toHaveText('Wrong username or password.');
    await login(page, `${name}@test.example`, PASSWORD, name);
  });

  test('registration validates duplicates and bad usernames', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Username').fill('bayo_builds');
    await page.getByLabel('Email').fill('new@test.example');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.locator('.flash-error')).toHaveText('That username is taken.');
    await expect(page.getByLabel('Email')).toHaveValue('new@test.example');
  });

  test('profile settings, avatar upload and password change persist', async ({ page }) => {
    const name = await register(page);
    await page.goto('/settings');
    await page.getByLabel('About you').fill('I love jollof debates.');
    await page.getByLabel('Location').fill('Jos');
    await page.getByLabel('Gender').selectOption('female');
    await page.getByLabel('Signature').fill('Stay hydrated.');
    await page.getByTestId('save-profile').click();
    await expect(page.locator('.flash')).toHaveText('Profile saved.');
    await page.getByLabel(/New photo/).setInputFiles(new URL('./fixtures/pixel.png', import.meta.url).pathname);
    await page.getByTestId('save-avatar').click();
    await expect(page.locator('.flash')).toHaveText('Photo updated.');
    await page.goto(`/u/${name}`);
    await expect(page.getByTestId('profile-bio')).toHaveText('I love jollof debates.');
    await expect(page.getByTestId('profile-location')).toHaveText('Jos');
    const avatar = page.locator('.profile img.avatar');
    await expect(avatar).toBeVisible();
    expect(await avatar.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

    await page.goto('/settings');
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password').fill('brandnewpass1');
    await page.getByTestId('save-password').click();
    await expect(page.locator('.flash')).toContainText('Password changed');
    await login(page, name, 'brandnewpass1');
  });
});

test.describe('posting', () => {
  test('create a topic with an image; it shows in the board, recent list and search', async ({ page }) => {
    await register(page);
    const title = `Generator vs inverter ${uniqueName('t')}`;
    await createTopic(page, 'money-business', title, 'Which is cheaper over [b]two years[/b]?', { image: true });
    await expect(page.locator('.post-body strong')).toHaveText('two years');
    const img = page.locator('.attachments img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    await page.goto('/b/money-business');
    await expect(page.getByTestId('topic-list')).toContainText(title);
    await page.goto('/recent');
    await expect(page.getByTestId('topic-list').locator('tbody tr').first()).toContainText(title);
    await page.goto(`/search?q=${encodeURIComponent('generator inverter')}`);
    await expect(page.getByTestId('search-results')).toContainText(title);
  });

  test('topic form keeps input and shows errors for invalid data', async ({ page }) => {
    await register(page);
    await page.goto('/b/tech-corner/new');
    await page.getByLabel('Title').fill('Hey');
    await page.getByLabel('Post').fill('Short title test');
    await page.getByLabel('Title').evaluate((el) => el.removeAttribute('minlength'));
    await page.getByTestId('submit-topic').click();
    await expect(page.locator('.flash-error')).toHaveText('Titles must be 5–150 characters.');
    await expect(page.getByLabel('Post')).toHaveValue('Short title test');
  });

  test('quote and @mention notify the other member', async ({ page, browser }) => {
    const author = await asNewUser(browser, 'au');
    const url = await createTopic(author.page, 'relationships', `Wedding budget tips ${uniqueName('w')}`, 'Keep the guest list short.');
    const firstPost = await lastPostId(author.page);

    const replier = await register(page, uniqueName('rp'));
    await page.goto(url);
    await page.getByTestId(`quote-${firstPost}`).click();
    await expect(page.getByLabel('Your reply')).toHaveValue(new RegExp(`\\[quote author=${author.name} post=${firstPost}\\]`));
    await page.getByLabel('Your reply').press('End');
    await page.getByLabel('Your reply').evaluate((el, n) => { el.value += `Totally agree @${n}`; }, author.name);
    await page.getByTestId('submit-reply').click();
    await expect(page.locator('article.post').last().locator('blockquote')).toContainText(`${author.name} said`);
    await expect(page.locator('article.post').last().locator('a.mention')).toHaveText(`@${author.name}`);

    await author.page.goto('/');
    await expect(author.page.getByTestId('unread-badge')).toHaveText('1');
    await author.page.getByRole('link', { name: /Alerts/ }).click();
    const note = author.page.getByTestId('notifications').locator('li').first();
    await expect(note).toContainText(`${replier} quoted you in`);
    await note.getByRole('link').last().click();
    await expect(author.page.locator('article.post').last()).toContainText('Totally agree');
    await expect(author.page.getByTestId('unread-badge')).toHaveCount(0);
    await author.ctx.close();
  });

  test('like and share toggle in place and persist after reload', async ({ page, browser }) => {
    const author = await asNewUser(browser, 'lk');
    const url = await createTopic(author.page, 'kitchen-food', `Pepper soup recipe ${uniqueName('p')}`, 'Goat meat, uziza, utazi.');
    const postId = await lastPostId(author.page);
    await register(page);
    await page.goto(url);
    const like = page.getByTestId(`like-${postId}`);
    await like.click();
    await expect(like).toHaveText('Liked 1');
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId(`share-${postId}`).click();
    await expect(page.getByTestId(`share-${postId}`)).toHaveText('Shared 1');
    await page.reload();
    await expect(page.getByTestId(`like-${postId}`)).toHaveText('Liked 1');
    await expect(page.getByTestId(`share-${postId}`)).toHaveText('Shared 1');
    await author.page.goto(`/u/${author.name}`);
    await expect(author.page.getByTestId('likes-received')).toHaveText('1');
    await page.getByTestId(`like-${postId}`).click();
    await expect(page.getByTestId(`like-${postId}`)).toHaveText('Like 0');
    await page.reload();
    await expect(page.getByTestId(`like-${postId}`)).toHaveText('Like 0');
    await author.ctx.close();
  });

  test('edit a post and its title; history keeps the old version', async ({ page }) => {
    await register(page);
    const url = await createTopic(page, 'schools-exams', `Exam timetable ${uniqueName('e')}`, 'Original revision plan');
    const postId = await lastPostId(page);
    await page.getByTestId(`edit-${postId}`).click();
    await page.getByLabel('Topic title').fill('Updated exam timetable plan');
    await page.getByLabel('Post').fill('Better revision plan');
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('topic-title')).toContainText('Updated exam timetable plan');
    await expect(page.locator(`#p${postId} .post-body`)).toHaveText('Better revision plan');
    await page.getByRole('link', { name: 'history' }).click();
    await expect(page.locator('.card').nth(1)).toContainText('Original revision plan');
    expect(url).toContain('/t/');
  });

  test("members cannot edit other people's posts", async ({ page }) => {
    await register(page);
    await page.goto('/b/tech-corner');
    await page.getByRole('link', { name: /programming language/ }).click();
    const first = await page.locator('article.post').first().getAttribute('id');
    await expect(page.getByTestId(`edit-${first.slice(1)}`)).toHaveCount(0);
    const res = await page.goto(`/p/${first.slice(1)}/edit`);
    expect(res.status()).toBe(403);
  });
});

test.describe('following', () => {
  test('follow a member and a board; feed and alerts update', async ({ page, browser }) => {
    const star = await asNewUser(browser, 'st');
    const fan = await register(page, uniqueName('fn'));
    await page.goto(`/u/${star.name}`);
    await page.getByTestId('follow-user').click();
    await expect(page.getByTestId('follow-user')).toHaveText('Unfollow');
    await expect(page.getByTestId('followers-count')).toHaveText('1 followers');
    await page.goto('/b/cars-motoring');
    await page.getByTestId('follow-board').click();
    await expect(page.getByTestId('follow-board')).toHaveText('Unfollow board');

    const title = `Tyre prices this month ${uniqueName('ty')}`;
    await createTopic(star.page, 'phones-gadgets', title, 'They doubled.');
    await page.goto('/followed');
    await expect(page.getByTestId('topic-list')).toContainText(title);
    await page.goto('/notifications');
    await expect(page.getByTestId('notifications')).toContainText(`${star.name} started a new topic: ${title}`);

    await star.page.goto(`/u/${star.name}/followers`);
    await expect(star.page.getByTestId('people')).toContainText(fan);
    await star.ctx.close();
  });

  test('follow a topic to hear about replies', async ({ page, browser }) => {
    const watcher = await asNewUser(browser, 'wt');
    await watcher.page.goto('/b/health-matters');
    await watcher.page.getByRole('link', { name: /Pharmacist here/ }).click();
    await watcher.page.getByTestId('follow-topic').click();
    await expect(watcher.page.getByTestId('follow-topic')).toHaveText('Unfollow topic');
    const url = watcher.page.url();

    const talker = await register(page, uniqueName('tk'));
    await page.goto(url);
    await reply(page, 'Thanks for doing this thread!');
    await watcher.page.goto('/notifications');
    await expect(watcher.page.getByTestId('notifications')).toContainText(`${talker} replied to Pharmacist here`);
    await watcher.ctx.close();
  });
});

test.describe('moderation', () => {
  test('report flows to the mod desk; hiding notifies the author and hides it from guests', async ({ page, browser }) => {
    const spammer = await asNewUser(browser, 'sp');
    const url = await createTopic(spammer.page, 'market-square', `Cheap followers ${uniqueName('s')}`, 'Buy 10k followers now');
    const postId = await lastPostId(spammer.page);

    const reporter = await asNewUser(browser, 'rq');
    await reporter.page.goto(url);
    await reporter.page.getByTestId(`report-${postId}`).click();
    await reporter.page.getByLabel(/What's wrong/).fill('Spam and scam');
    await reporter.page.getByTestId('submit-report').click();
    await expect(reporter.page.locator('.flash')).toContainText('moderators have been told');

    await login(page, ADMIN.username, ADMIN.password);
    await page.getByRole('link', { name: 'Mod desk' }).click();
    const card = page.getByTestId('reports').locator('.report', { hasText: 'Spam and scam' });
    await expect(card).toContainText(spammer.name);
    await card.getByRole('button', { name: 'Hide post' }).click();
    await page.getByTestId('reports').locator('.report', { hasText: 'Spam and scam' }).getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.getByTestId('reports')).not.toContainText('Spam and scam');

    await spammer.page.goto('/notifications');
    await expect(spammer.page.getByTestId('notifications')).toContainText(`${ADMIN.username} hid your post in`);
    const guest = await browser.newPage();
    await guest.goto(url);
    await expect(guest.locator(`#p${postId} .hidden-note`)).toBeVisible();
    await expect(guest.locator(`#p${postId}`)).not.toContainText('Buy 10k followers');
    await page.goto('/mod/log');
    await expect(page.getByTestId('mod-log')).toContainText('resolved');
    await Promise.all([spammer.ctx.close(), reporter.ctx.close(), guest.close()]);
  });

  test('pin, lock, feature, move and hide a topic', async ({ page, browser }) => {
    const member = await asNewUser(browser, 'mm');
    const title = `Moderated topic ${uniqueName('m')}`;
    const url = await createTopic(member.page, 'tech-corner', title, 'This belongs in football really');
    await login(page, ADMIN.username, ADMIN.password);
    await page.goto(url);
    await page.getByTestId('mod-sticky').click();
    await expect(page.getByTestId('topic-title')).toContainText('Pinned');
    await page.getByTestId('mod-locked').click();
    await expect(page.getByTestId('topic-title')).toContainText('Locked');
    await page.getByTestId('mod-featured').click();
    await page.goto('/');
    await expect(page.getByTestId('front-page')).toContainText(title);

    await member.page.goto(url);
    await expect(member.page.getByText('This topic is locked.')).toBeVisible();
    const csrf = await member.page.locator('meta[name=csrf]').getAttribute('content');
    const id = url.split('/')[2];
    const res = await member.page.request.post(`/t/${id}/reply`, { form: { _csrf: csrf, body: 'sneaky reply' } });
    expect(res.status()).toBe(403);

    await page.goto(url);
    await page.getByLabel('Move to board').selectOption('football');
    await page.getByTestId('mod-move').click();
    await expect(page.locator('.flash')).toHaveText('Topic moved to Football.');
    await page.goto('/b/football');
    await expect(page.getByTestId('topic-list').locator('tbody tr').first()).toContainText(title);

    await page.goto(url);
    await page.getByTestId('mod-hidden').click();
    const gone = await member.page.goto(url);
    expect(gone.status()).toBe(404);
    await member.ctx.close();
  });

  test('ban ends the session and blocks login; unban restores access', async ({ page, browser }) => {
    const troll = await asNewUser(browser, 'tr');
    await login(page, ADMIN.username, ADMIN.password);
    await page.goto(`/u/${troll.name}`);
    await page.getByText('Moderator tools').click();
    await page.getByLabel('Days').fill('2');
    await page.getByLabel('Reason').fill('Insulting members');
    await page.getByTestId('ban').click();
    await expect(page.locator('.flash').first()).toContainText('has been banned');

    await troll.page.goto('/');
    await expect(troll.page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await troll.page.goto('/login');
    await troll.page.getByLabel('Username or email').fill(troll.name);
    await troll.page.getByLabel('Password').fill(PASSWORD);
    await troll.page.getByTestId('login-submit').click();
    await expect(troll.page.locator('.flash-error')).toContainText('Insulting members');

    await page.getByText('Moderator tools').click();
    await page.getByTestId('unban').click();
    await login(troll.page, troll.name);
    await troll.ctx.close();
  });

  test('admin creates a board and assigns a moderator who can only moderate it', async ({ page, browser }) => {
    const mod = await asNewUser(browser, 'md');
    await login(page, ADMIN.username, ADMIN.password);
    await page.getByRole('link', { name: 'Admin' }).click();
    const sectionName = `Hobbies ${uniqueName('h')}`;
    await page.getByLabel('Name').first().fill(sectionName);
    await page.getByTestId('create-section').click();
    await expect(page.locator('.flash')).toHaveText('Section created.');
    const boardName = `Chess Club ${uniqueName('c')}`;
    const form = page.locator('form', { has: page.getByTestId('create-board') });
    await form.getByLabel('Section').selectOption({ label: sectionName });
    await form.getByLabel('Name').fill(boardName);
    await form.getByLabel('Description').fill('Openings and endgames');
    await page.getByTestId('create-board').click();
    await expect(page.getByRole('heading', { name: boardName })).toBeVisible();
    const slug = new URL(page.url()).pathname.split('/')[2];

    await page.goto('/admin');
    const modForm = page.locator('form', { has: page.getByTestId('assign-mod') });
    await modForm.getByLabel('Board').selectOption(slug);
    await modForm.getByLabel('Username').fill(mod.name);
    await page.getByTestId('assign-mod').click();
    await expect(page.locator('.flash')).toHaveText('Moderators updated.');
    await page.goto('/boards');
    await expect(page.locator('.directory')).toContainText(sectionName);

    const url = await createTopic(mod.page, slug, 'Best opening for beginners?', 'Italian or London?');
    await expect(mod.page.getByTestId('mod-bar')).toBeVisible();
    await mod.page.goto('/b/tech-corner');
    await mod.page.getByRole('link', { name: /programming language/ }).click();
    await expect(mod.page.getByTestId('mod-bar')).toHaveCount(0);
    await mod.page.goto(url);
    await mod.page.getByTestId('mod-sticky').click();
    await expect(mod.page.getByTestId('topic-title')).toContainText('Pinned');
    await mod.ctx.close();
  });
});

test.describe('security and layout', () => {
  test('posts without a CSRF token are rejected', async ({ page }) => {
    await register(page);
    const res = await page.request.post('/b/tech-corner/new', { form: { title: 'No token here', body: 'should fail' } });
    expect(res.status()).toBe(403);
  });

  test('user-supplied HTML is escaped', async ({ page }) => {
    await register(page);
    await createTopic(page, 'jokes-banter', `Markup test ${uniqueName('x')}`, '<img src=x onerror="window.pwned=1"> hello');
    await expect(page.locator('.post-body').first()).toContainText('<img src=x');
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  });

  test('topic and home pages fit a phone screen without sideways scrolling', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await ctx.newPage();
    for (const path of ['/', '/b/tech-corner', '/recent']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });
});
