import { expect } from '@playwright/test';

export const ADMIN = { username: 'hallkeeper', password: 'Gisthall#2026' };
export const PASSWORD = 'password123';
export const PIXEL = new URL('./fixtures/pixel.png', import.meta.url).pathname;

let counter = 0;
export const uniqueName = (prefix = 'u') => `${prefix}${Date.now().toString(36).slice(-6)}${counter++}`;

export async function register(page, username = uniqueName()) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@test.example`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('me')).toHaveText(username);
  return username;
}

export async function login(page, loginName, password = PASSWORD, expectedName = loginName) {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(loginName);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('me')).toHaveText(expectedName);
}

export async function logout(page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
}

/** Create a topic through the UI and return its URL. */
export async function createTopic(page, board, title, body, { image = false } = {}) {
  await page.goto(`/b/${board}`);
  await page.getByTestId('new-topic').click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Post').fill(body);
  if (image) await page.getByLabel('Attach images').setInputFiles(PIXEL);
  await page.getByTestId('submit-topic').click();
  await expect(page.getByTestId('topic-title')).toContainText(title);
  return new URL(page.url()).pathname;
}

export async function reply(page, body) {
  await page.getByLabel('Your reply').fill(body);
  await page.getByTestId('submit-reply').click();
  await expect(page.locator('.post-body').last()).toContainText(body.split('\n').pop().slice(0, 20));
}

/** Id of the last post on the current topic page. */
export async function lastPostId(page) {
  const id = await page.locator('article.post').last().getAttribute('id');
  return Number(id.slice(1));
}

/** Fresh browser context so two members can act side by side. */
export async function asNewUser(browser, prefix) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const name = await register(page, uniqueName(prefix));
  return { ctx, page, name };
}
