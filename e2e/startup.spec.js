import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUSY_PORT = 4180;

function occupy(port) {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(port, () => resolve(srv));
  });
}

function runServer(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gisthall-port-'));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    env: { ...process.env, PORT: '', START_PORT: '', DB_PATH: path.join(dir, 'p.db'), ...env },
    stdio: 'pipe',
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const cleanup = () =>
    new Promise((resolve) => {
      const done = () => {
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      };
      if (proc.exitCode !== null) return done();
      proc.once('exit', done);
      proc.kill('SIGTERM');
    });
  return { proc, output: () => out, cleanup };
}

async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

test('when the default port is busy the server moves to the next free port and serves pages', async ({ browser }) => {
  const blocker = await occupy(BUSY_PORT);
  const server = runServer({ START_PORT: String(BUSY_PORT) });
  try {
    await waitFor(() => server.output().includes('running at'));
    expect(server.output()).toContain(`Port ${BUSY_PORT} is busy, trying ${BUSY_PORT + 1}`);
    expect(server.output()).toContain(`Gisthall running at http://localhost:${BUSY_PORT + 1}`);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${BUSY_PORT + 1}/`);
    await expect(page.getByTestId('stats')).toContainText('members');
    await expect(page.getByTestId('front-page').locator('li')).not.toHaveCount(0);
    await page.close();
  } finally {
    await server.cleanup();
    blocker.close();
  }
});

test('an explicitly chosen busy PORT exits with a clear message instead of a stack trace', async () => {
  const blocker = await occupy(BUSY_PORT);
  const server = runServer({ PORT: String(BUSY_PORT) });
  try {
    const code = await new Promise((resolve) => server.proc.once('exit', resolve));
    expect(code).toBe(1);
    expect(server.output()).toContain(`Port ${BUSY_PORT} is already in use`);
    expect(server.output()).not.toContain('Unhandled');
  } finally {
    await server.cleanup();
    blocker.close();
  }
});
