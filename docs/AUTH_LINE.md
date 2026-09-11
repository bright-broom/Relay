# Google認証・LINE通知

実装済みの接続基盤。実サービスでの利用開始には、Google OAuth、PostgreSQL、LINE Messaging APIの設定が必要。設定が揃うまではログインを拒否する。案件画面は引き続き架空データのプロトタイプであり、案件データのサーバー同期・期限の自動通知は未実装。

## Google認証

Google OpenID ConnectのAuthorization Code + PKCEを `openid-client` 6.8.8で処理する。state・nonce・署名・issuer・audience・有効期限を検証。Google確認済みメールかつサーバーの `ALLOWED_GOOGLE_EMAILS` に完全一致したアカウントだけを許可する。GmailおよびGoogleが管理するWorkspaceアカウントが対象。許可リストはカンマ区切り、大文字小文字を区別しない。ドメイン全体許可・自動登録はない。

ログイン試行は10分、一度だけ消費する。セッションは8時間固定期限。ブラウザーにはランダムな識別子をSecure / HttpOnly / SameSite=Lax / __Host- Cookieで渡し、DBにはそのSHA-256ハッシュのみ保存する。ログイン用のGoogleトークンは保存・ブラウザー配布しない。カレンダー接続の追加権限と暗号化保存は [CALENDAR_MCP.md](CALENDAR_MCP.md) を参照。毎回のセッション照会で現在の許可リストを確認するため、リストから外したアカウントは再利用できない（Vercel環境変数変更後は再デプロイが必要）。ログアウトでDBセッションも削除する。

Vercelのルートを静的ファイル配信より先に評価し、`/`、`/index.html`、`/assets/app.js`を認証ゲートへ通す。APIはそれぞれセッションを確認し、変更操作はPOSTおよび同一Originを要求する。認証関連・アプリの応答はCDNを含めno-store。サーバー用コードと環境変数はブラウザーのビルドへ含めない。

静的配信ディレクトリは `public/`。CSS・起動時の認証確認・アイコン・公開ガイドだけを生成し、アプリHTML/本体JSは配置しない。TypeScriptの `src/server/handler.ts` から `api/relay.mjs` をビルドし、アプリ本体はFunction内の添付ファイルから認証後に配信する。認証機能はAPP_ORIGINの正規ホストのみで利用でき、古いデプロイ固有URLへのセッション持ち出しを拒否する。

## LINE通知

LINEログインは使わず、LINE公式アカウントのMessaging APIを使う。個人・グループ各1件をGoogleアカウントごとに登録できる。

1. アプリ右上のアカウントアイコンから「個人のLINE」を選んでコードを発行する。
2. 公式アカウントを友だち追加し、その個人トークへコードを送る。
3. アプリで「更新」→「この通知先を連携」。ここまでは自動返信・通知を送らない。
4. グループも同様に登録する。先に個人を確定し、同じ本人のLINEから、公式アカウントを招待したグループにコードを送る。
5. 「テスト通知を送信」を押したときだけ、固定の接続確認メッセージとアプリURLを送る。

コードは256ビットのランダム値・10分間・一回限り。DBではハッシュ保存。Webhookは生のリクエスト本文でHMAC-SHA256署名を照合してから解析する。イベントIDで再配信を重複排除し、DBトランザクションでコードの消費と通知先の登録をまとめる。登録直後は確認待ちで、アプリから確定するまで送信不可。別ユーザーの通知先は操作できない。ブロック・グループ退出で通知先を削除。個人の解除・差し替えでグループの紐付けも解除する。

通知は固定内容のみ。送信先ID・自由本文・任意URLをクライアントから受け付けない。DBに送信記録とリトライキーを保存し、LINEの `X-Line-Retry-Key` で同じ通知の再送を重複排除する。タイムアウト時は同じ画面から同じキーで再試行。自動バックグラウンド再送は未実装。最大5試行・23時間以内、アカウントごと新規通知10件/時。API受付成功は受信・既読の保証ではない。画面を閉じて新しく送る操作は別通知となる。

## 接続手順

秘密情報はチャット・公開リポジトリへ貼らず、VercelのProject Settings → Environment VariablesへProduction対象で直接設定する。例は `.env.example`。設定後は再デプロイする。Previewには本番の秘密情報をコピーしない。

| 設定 | 内容 |
|---|---|
| APP_ORIGIN | `https://relay-brightbroom.vercel.app`（末尾パスなし） |
| ALLOWED_GOOGLE_EMAILS | 許可するメールアドレス。初期の1件は別途Vercelに設定済み |
| GOOGLE_CLIENT_ID | Google OAuthのWebアプリのクライアントID |
| GOOGLE_CLIENT_SECRET | 同クライアントのシークレット |
| DATABASE_URL | NeonまたはSupabaseのPostgreSQLプール接続URL |
| LINE_CHANNEL_SECRET | Messaging APIチャネルのシークレット |
| LINE_CHANNEL_ACCESS_TOKEN | 同チャネルのチャネルアクセストークン |

### Google Cloud

プロジェクトでOAuth同意画面を構成し、OAuthクライアント「ウェブアプリケーション」を作成。承認済みリダイレクトURIに次を完全一致で登録する。

`https://relay-brightbroom.vercel.app/api/auth/callback`

要求スコープは `openid email` のみ。テスト公開の場合は、利用するアカウントをGoogle側のテストユーザーにも追加する。アプリ側ホワイトリストとは別の設定。

### データベース

Neon / Supabaseのどちらでも使えるようPostgreSQL接続を分離している。サーバーレス用プールURL・TLS証明書検証・prepared statements無効・プロセスごと最大1接続。`DATABASE_URL` はサーバー専用のDBロールを使用する。ブラウザー向けのanon/publishable keyは使用しない。

専用DBまたは専用の `relay_private` スキーマを作成する権限のある所有者接続を `MIGRATION_DATABASE_URL` に設定した安全なローカル環境で `npm run db:migrate` を実行する。この値は実行時サーバーには不要。マイグレーションはトランザクションと適用履歴で再実行可能。別の実行用ロールを使う場合は、そのロールにrelay_privateのUSAGEと対象テーブルのSELECT/INSERT/UPDATE/DELETEだけを管理者から付与する。

Supabaseでは `relay_private` を公開APIのExposed schemasに追加しない。マイグレーションはPUBLICのスキーマ・テーブル権限を剥奪する。Supabaseのservice roleなど既存の管理ロールの権限は別途管理する。ブラウザーから直接DBへアクセスしない。

期限切れ試行・セッションはログイン時に整理する。Webhook IDと通知の監査記録は現在自動削除しないため、運用開始時に保存期間と定期削除を設定する。

### LINE公式アカウント

公式アカウントのMessaging APIを有効化し、LINE Developersの対応チャネルから接続情報を取得する。Webhook URLは次。

`https://relay-brightbroom.vercel.app/api/line/webhook`

Webhook利用・再送を有効化して「検証」。グループ利用には「グループ・複数人トークへの参加を許可」を有効化する。必要に応じて標準の応答メッセージ・あいさつを管理画面で調整する。LINE側プランの送信枠は別途適用される。

## PWAと既存プロトタイプ

認証導入に伴い、HTML・アプリ・APIのオフライン配信を停止。新しいWorkerは以前のRelayキャッシュを削除し、開いている画面を一度再読み込みする。以後すべてネットワーク経由。アプリは起動・復帰・表示中60秒ごとにセッション確認し、未認証ならログインへ戻す。ホーム画面への追加は継続可能。

既に配布された公開デモやGitHubの架空サンプルは遡って秘密にはできない。古いインストールは一度オンラインで更新する。`file://` は架空データのローカルデザインプレビューとして残し、認証・LINEは使えない。実データや秘密情報を追加しない。

端末内の案件保存はサンプル用途。アカウント切替・ログアウトで破棄する。実案件同期、組織単位の権限管理、担当者の期限通知、通知設定の細分化は次の実装範囲。

## 検証

`npm run check` はstrict型検査・デザイン/文言監査・既存操作テストと `tests/server.mjs` を実行する。PGlite上で本物のSQLを使い、合成署名付きOIDCで成功・state/nonce/署名/audience/issuer/期限/メール不正、セッション失効、Webhook改ざん・再送、個人/グループの所有権、通知の同一キー再送・上限、未設定/未認証の拒否を確認する。外部へのメッセージ送信は行わない。

Google実アカウントの往復、実LINE配信、Neon/Supabase実接続、iOS/Androidの画面・インストールは未検証。ブラウザー操作は自動セキュリティ確認を完了できないため制限されており、別手段でその制限を回避しない。

## 公式資料

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [openid-client](https://github.com/panva/openid-client)
- [LINE Messaging APIの開始](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Webhookの署名検証](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE送信の再試行](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
