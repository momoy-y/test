// 通知チャネルの登録場所。
//
// 通知手段を追加したい場合は、
//   async function myNotifier(events) { ... }
// という形の関数を定義し、末尾の `notifiers` 配列に追加するだけでよい。
// events は [{ id, name, url, category, at }, ...] の配列（変更が検知されたサイトのみ）。
// 各通知関数は自分に必要な環境変数（Webhook URLなど）が未設定なら何もせず戻ること。

import https from 'node:https';

function postJson(urlString, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 常に有効: コンソール（GitHub Actionsのログ等）に出力するだけの通知
async function consoleNotifier(events) {
  for (const e of events) {
    console.log(`[NOTIFY] [${e.category}] ${e.name} に更新の可能性があります -> ${e.url}`);
  }
}

// Slack Incoming Webhook。環境変数 SLACK_WEBHOOK_URL が設定されている場合のみ動作する。
async function slackNotifier(events) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const lines = events.map((e) => `• *[${e.category}]* <${e.url}|${e.name}>`);
  const text = [
    `:mag: 求人監視ダッシュボード: ${events.length}件のサイトで更新を検知しました`,
    ...lines,
  ].join('\n');

  await postJson(webhookUrl, { text });
}

// 追加の通知チャネル例（今後の拡張用テンプレート。必要になったら実装してnotifiersに追加する）:
//
// async function discordNotifier(events) {
//   const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
//   if (!webhookUrl) return;
//   const content = events.map((e) => `[${e.category}] ${e.name} - ${e.url}`).join('\n');
//   await postJson(webhookUrl, { content });
// }
//
// async function emailNotifier(events) {
//   // 例: SendGrid / Resend などのHTTP APIを叩く実装をここに追加する
// }

const notifiers = [consoleNotifier, slackNotifier];

export async function sendNotifications(events) {
  if (!events || events.length === 0) return;
  for (const notifier of notifiers) {
    try {
      await notifier(events);
    } catch (err) {
      console.error(`[notify] ${notifier.name} failed:`, err.message);
    }
  }
}
