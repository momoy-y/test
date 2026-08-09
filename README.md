# 求人監視ダッシュボード

複数の求人・採用情報サイトの更新を監視する、静的HTMLダッシュボードです。
サイトを増やしたり、通知の仕組みを追加したりといった、あとからのメンテナンスがしやすい構成にしています。

## 仕組み

```
config/sites.json   … 監視対象サイトの一覧（カテゴリー別）。編集するのはここが中心。
scripts/check.mjs   … 各サイトを取得し、内容のハッシュを前回と比較して変更を検知する。
scripts/notify.mjs  … 変更を検知したときの通知先（Slack等）。ここに通知チャネルを追加する。
data/state.json     … 各サイトの最新状態（チェック日時・変更検知日時・エラー等）。check.mjsが更新。
data/history.json   … 変更検知イベントの履歴（直近200件）。
index.html          … 上記JSONを読み込んで表示する、依存ライブラリなしの静的ダッシュボード。
.github/workflows/monitor.yml … GitHub Actionsで定期的にcheck.mjsを実行し、結果をコミットする。
```

- 各サイトはページのHTMLからタグを除いたテキストをSHA-256でハッシュ化し、前回チェック時のハッシュと比較することで
  「内容が変わったかどうか」を検知します（求人の見出し文言などを個別サイトごとにパースするのではなく、汎用的な変更検知方式です）。
- サイトごとの構造は大きく異なるため、まずはこの汎用方式で「更新があったかもしれない」ことに気づけるようにしています。
  特定サイトについてもっと精密に「新着求人のタイトルだけ」を抽出したい場合は、`scripts/check.mjs`の`fetchSite`/`normalizeHtml`を
  サイト単位で拡張してください（例: サイトごとにCSSセレクタで対象領域を絞る等）。

## サイトを増やす・減らす

`config/sites.json` を編集するだけです。スクリプトやHTMLの変更は不要です。

```json
{
  "id": "example-city-saiyou",
  "name": "○○市 職員採用情報",
  "url": "https://example.jp/saiyou.html"
}
```

を `categories[].sites[]` に追加してください。カテゴリー自体を増やす場合は `categories` に
`{ "id": "...", "name": "...", "sites": [...] }` を追加します。

**注意**: `id` は一度決めたら変更しないでください。`id`をキーにして`data/state.json`の履歴を管理しているため、
`id`を変更すると変更検知の基準（過去のハッシュ）がリセットされます。

## 通知の仕組みを増やす

`scripts/notify.mjs` に通知チャネルを追加します。変更を検知したサイトのリストを受け取る
`async function myNotifier(events) { ... }` という関数を書いて、ファイル末尾の `notifiers` 配列に追加するだけです。

現在同梱しているもの:
- **console通知**（常時有効）: GitHub Actionsの実行ログに変更内容を出力します。
- **Slack通知**（任意）: リポジトリのSecretsに `SLACK_WEBHOOK_URL`（Incoming Webhook URL）を設定すると自動的に有効になります。

Discordやメール送信など他のチャネルを追加したい場合は、`scripts/notify.mjs`内のテンプレートコメントを参考にしてください。
各通知関数は、自分に必要な環境変数（Webhook URLなど）が未設定なら何もせず戻るようにしてあるので、
設定されていないチャネルがあってもスクリプト全体は正常に動作します。

## 自動実行（GitHub Actions）

`.github/workflows/monitor.yml` が、
1. 6時間ごと（cronはUTC基準。頻度はワークフロー内のcron式で変更可能）
2. `config/sites.json` や `scripts/**` を変更してpushしたとき
3. 手動実行（Actionsタブから "Run workflow"）

のいずれかのタイミングで `scripts/check.mjs` を実行し、`data/state.json` / `data/history.json` に差分があれば
自動的にコミット・pushします。ダッシュボード（`index.html`）はこのJSONを読み込むだけなので、
ワークフローが回るたびに表示内容が最新化されます。

### 重要: このセッションでは実サイトへのチェックを実行できていません

この開発セッションのサンドボックス環境は、セキュリティ上の理由で対象サイトへの外向き通信（アウトバウンドネットワーク）が
ブロックされており、`scripts/check.mjs` を実サイトに対して実行することができませんでした
（ロジック自体はモックしたHTTPレスポンスでの単体テストで動作確認済みです）。
そのため `data/state.json` は「まだチェックが実行されていない」プレースホルダー状態でリポジトリに含めています。

実際のチェックを行うには、以下のいずれかを実施してください。
- このリポジトリをGitHubにpushした後、Actionsタブから `Job Monitor Check` ワークフローを手動実行する（`workflow_dispatch`）
- または、ローカル環境（インターネットに接続できる場所）で `node scripts/check.mjs` を実行し、変更をコミットする

## ローカルでの動作確認

```bash
# 1. 手動でチェックを実行（data/state.json, data/history.json が更新される）
node scripts/check.mjs

# 2. 簡易サーバーでダッシュボードを開く
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

`index.html` を `file://` で直接開くと、ブラウザのセキュリティ制限により `data/state.json` を
`fetch` できずエラー表示になることがあります。必ず簡易サーバー経由（またはGitHub Pages等でのホスティング）で開いてください。

## GitHub Pagesで公開する場合

リポジトリの Settings → Pages で、公開元をこのリポジトリのデフォルトブランチ（ルート）に設定するだけで、
`index.html` と `data/state.json` がそのまま静的サイトとして公開されます。ビルド手順は不要です。

## ダッシュボードの見方

- **稼働中 / エラー**: 直近のチェックでサイトに正常にアクセスできたかどうか。
- **更新あり**: 直近14日以内に内容の変更を検知したサイト（この日数は `index.html` 内の `RECENT_CHANGE_DAYS` で変更可能）。
- **未チェック**: まだ一度もチェックが実行されていないサイト。
