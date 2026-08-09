#!/usr/bin/env node
// 監視対象サイトを巡回し、内容の変化を検知して data/state.json / data/history.json を更新するスクリプト。
//
// 使い方:
//   node scripts/check.mjs
//
// サイトの追加・削除は config/sites.json を編集するだけでよい（このスクリプトの変更は不要）。
// 通知チャネルの追加は scripts/notify.mjs を参照。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sendNotifications } from './notify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITES_PATH = path.join(ROOT, 'config', 'sites.json');
const STATE_PATH = path.join(ROOT, 'data', 'state.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');

const FETCH_TIMEOUT_MS = 20000;
const MAX_HISTORY_EVENTS = 200;

function normalizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

async function fetchSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobMonitorBot/1.0; +static job monitoring dashboard)',
        'Accept-Language': 'ja,en;q=0.5',
      },
    });
    const html = await res.text();
    return { ok: res.ok, httpStatus: res.status, html };
  } finally {
    clearTimeout(timer);
  }
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function main() {
  const sitesConfig = JSON.parse(await readFile(SITES_PATH, 'utf8'));
  const prevState = await loadJson(STATE_PATH, { generatedAt: null, sites: {} });
  const history = await loadJson(HISTORY_PATH, { events: [] });

  const nextSites = {};
  const changedEvents = [];
  const now = new Date().toISOString();

  for (const category of sitesConfig.categories) {
    for (const site of category.sites) {
      const prev = prevState.sites?.[site.id];
      let record;

      try {
        const { ok, httpStatus, html } = await fetchSite(site.url);
        const text = normalizeHtml(html);
        const contentHash = crypto.createHash('sha256').update(text).digest('hex');
        const title = extractTitle(html);
        const hadBaseline = Boolean(prev && prev.contentHash);
        const changed = hadBaseline && prev.contentHash !== contentHash;

        record = {
          id: site.id,
          name: site.name,
          url: site.url,
          categoryId: category.id,
          categoryName: category.name,
          ok,
          httpStatus,
          title,
          contentHash,
          firstCheckedAt: prev?.firstCheckedAt ?? now,
          lastCheckedAt: now,
          lastChangedAt: changed ? now : (prev?.lastChangedAt ?? null),
          lastError: null,
          checkCount: (prev?.checkCount ?? 0) + 1,
        };

        if (changed) {
          const event = { id: site.id, name: site.name, url: site.url, category: category.name, at: now };
          changedEvents.push(event);
          history.events.unshift({
            siteId: site.id,
            name: site.name,
            category: category.name,
            url: site.url,
            changedAt: now,
          });
        }
      } catch (err) {
        record = {
          id: site.id,
          name: site.name,
          url: site.url,
          categoryId: category.id,
          categoryName: category.name,
          ok: false,
          httpStatus: prev?.httpStatus ?? null,
          title: prev?.title ?? null,
          contentHash: prev?.contentHash ?? null,
          firstCheckedAt: prev?.firstCheckedAt ?? now,
          lastCheckedAt: now,
          lastChangedAt: prev?.lastChangedAt ?? null,
          lastError: err.message,
          checkCount: (prev?.checkCount ?? 0) + 1,
        };
      }

      nextSites[site.id] = record;
    }
  }

  history.events = history.events.slice(0, MAX_HISTORY_EVENTS);

  const nextState = { generatedAt: now, sites: nextSites };

  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n', 'utf8');

  await sendNotifications(changedEvents);

  const errorCount = Object.values(nextSites).filter((s) => !s.ok).length;
  console.log(
    `Checked ${Object.keys(nextSites).length} sites: ${changedEvents.length} changed, ${errorCount} errors.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
