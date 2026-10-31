import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register, login, createTopic, reply, uniqueName } from './helpers.js';

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

function startServer(dbPath) {
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, FLOOD_SECONDS: '0' },
    stdio: 'pipe',
  });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('running at') && resolve(proc));
    proc.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
    setTimeout(() => reject(new Error('server did not start')), 15_000);
  });
}

const stopServer = (proc) => new Promise((resolve) => { proc.once('exit', resolve); proc.kill('SIGTERM'); });

test('accounts, topics, replies, likes and settings survive a full server restart', async ({ browser }) => {
  test.setTimeout(60_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gisthall-e2e-'));
  const dbPath = path.join(dir, 'restart.db');
  let server = await startServer(dbPath);

  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const name = await register(page, uniqueName('ps'));
  const title = `Survives restart ${uniqueName('r')}`;
  const url = await createTopic(page, 'tech-corner', title, 'First post before restart', { image: true });
  await reply(page, 'Second post before restart');
  const postId = (await page.locator('article.post').first().getAttribute('id')).slice(1);
  await page.getByTestId(`like-${postId}`).click(); // own post: still allowed, still counted
  await expect(page.getByTestId(`like-${postId}`)).toHaveText('Liked 1');
  await page.goto('/settings');
  await page.getByLabel('Location').fill('Calabar');
  await page.getByTestId('save-profile').click();
  await ctx.close();

  await stopServer(server);
  server = await startServer(dbPath);
  try {
    const ctx2 = await browser.newContext({ baseURL: BASE });
    const p2 = await ctx2.newPage();
    await login(p2, name);
    await p2.goto(url);
    await expect(p2.getByTestId('topic-title')).toContainText(title);
    await expect(p2.locator('.post-body')).toHaveText(['First post before restart', 'Second post before restart']);
    await expect(p2.getByTestId(`like-${postId}`)).toHaveText('Liked 1');
    expect(await p2.locator('.attachments img').evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    await p2.goto(`/u/${name}`);
    await expect(p2.getByTestId('profile-location')).toHaveText('Calabar');
    await p2.goto(`/search?q=${encodeURIComponent('survives restart')}`);
    await expect(p2.getByTestId('search-results')).toContainText(title);
    await ctx2.close();
  } finally {
    await stopServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
