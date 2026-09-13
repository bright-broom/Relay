# Googleカレンダー・MCPによる日程調整

カレンダーの空き時間から候補を計算し、選択した候補をGoogleカレンダーへ登録する。アプリ画面とMCPから同じ処理を利用できる。初期版は本人のメインカレンダーが対象。実サービスの接続情報が未設定のため、実際のGoogle予定の取得・登録はまだ利用開始していない。

## アプリでの操作

1. ログイン後、左サイドバーのカレンダーアイコンを開く。案件詳細から開くと、次の対応を予定名の初期値にする。
2. 「Googleカレンダーを接続」で追加の利用権限を許可する。Relayのログインと同じGoogleアカウントのみ接続できる。
3. 開始日・所要時間を選び、「空き時間から候補を作成」。標準は日本時間、平日9〜18時、前後15分の余裕、7日間、所要60分。詳細条件は折りたたみ内で変更できる。
4. 候補の日時を確認して「この日時で登録」。他の人への招待メールは送らず、本人のカレンダーに予定を作る。

予定名は案件の次の対応と定型名から選択でき、独自の予定名だけ直接入力する。開始日は「今日・明日・7日後」と日付ピッカーを使う。候補日は選択タイムゾーンの日付から計算する。条件を変更したら古い候補を消し、再作成を求める。Google上の予定名・内容の一括読み込みや、会話からの曖昧な日時の推測はしない。日時はタイムゾーンとともに表示する。

## 日程計算・登録

- 日時計算に `@js-temporal/polyfill` 0.5.1、入力検証にZod 4.6.2を使用。IANAタイムゾーン・夏時間に対応し、UTCの時刻で重なりを比較する。
- 検索は最大14日、開始日は当日〜60日先、候補数は最大10件。営業時間・曜日・所要時間・前後の余裕を指定できる。15分単位で探索し、開始まで30分以上ある枠を候補にする。
- Google FreeBusyのエラーを「空いている」と扱わない。候補はDBに本人と紐付けて保存し、15分で失効する。クライアントから任意の日時を直接登録できない。
- 登録時は候補の本人確認・有効期限・空き時間を再確認。Relay内の同一アカウントの登録処理をDBロックで直列化する。
- 予定IDは本人と候補IDから決定する。Google登録後に通信やDB更新が失敗しても、同じ候補IDで再試行すると既存予定を照合し、重複作成しない。
- Google側で予定が変更・削除された場合は上書きせず、確認が必要な状態を返す。
- Google APIには「空き時間確認と登録」を一体で確定する操作がないため、他アプリが全く同時に書き込む競合を完全には防げない。
- 予定はprivate、attendeesなし、sendUpdates=none、通知リマインダーなし。参加者の合意済み・案件タスク完了という意味にはしない。LINEへの自動通知も行わない。

## Google接続

通常のログイン権限 `openid email` に加え、カレンダー接続時だけ次の権限を要求する。

- `https://www.googleapis.com/auth/calendar.events.freebusy`
- `https://www.googleapis.com/auth/calendar.events.owned`

登録先はprimaryに固定。接続時はAuthorization Code + PKCE、state、nonce、IDトークンの署名・issuer・audience・期限・本人subjectを確認する。権限の一部だけを許可した場合は接続を完了しない。

バックグラウンド利用のrefresh tokenはAES-256-GCMで暗号化して専用DBへ保存する。暗号には本人subjectを関連付け、別アカウントへの暗号文の移し替えを検出する。復号キーはVercelのサーバー環境変数 `TOKEN_ENCRYPTION_KEY`。Googleのaccess tokenは処理中のメモリのみで使用し、ブラウザーやMCPクライアントへ渡さない。

連携解除で保存済みトークンと未登録候補を削除する。既に作成した予定は削除しない。Google側のOAuth同意そのものを取り消す場合は、Googleアカウントの接続管理でも解除する。

## MCP

この実装は **RelayをMCPサーバーとして公開** する。外部のAIツールがRelayのカレンダー機能を呼べる。Relayが任意の第三者MCPサーバーへ接続する汎用クライアント機能ではない。

接続先：`https://relay-chi-ecru.vercel.app/api/mcp`

公式TypeScript SDK `@modelcontextprotocol/server` 2.0.0を使用。Streamable HTTP、リクエストごとに本人専用サーバーを生成する。2026-07-28と2025系の互換経路をSDKで処理する。長時間接続やサブスクリプションは使わない。

| ツール | 機能 | 必要なキー権限 |
|---|---|---|
| relay_get_calendar_status | 本人の接続状態を取得 | read / book |
| relay_find_slots | 空き時間を検索。予定は作らない | read / book |
| relay_propose_schedule | 予定名と条件から期限付き候補を保存 | book |
| relay_book_slot | 本人の候補IDを再確認して登録 | book |

日程画面の「AIツールとの連携」でキーを発行する。既定は確認専用。予定登録を許可する場合は明示的に切り替える。キーは一度だけ表示、有効期限30日、最大5件、いつでも無効化可能。DBにはSHA-256ハッシュのみ保存。リクエストごとに有効期限・失効・現在のホワイトリストを確認する。

接続キーをAIツールの秘密情報用設定へ保存し、次の形式で送る。

```http
Authorization: Bearer <Relayで発行した接続キー>
```

接続URLとヘッダーは画面からコピーできる。設定形式はクライアントごとに異なる。固定Authorizationヘッダーを設定できるMCPクライアントが対象。MCP OAuthによる自動認可を必須とするクライアント向けのOAuth認可サーバーは未実装。Googleトークンの持ち込みは拒否する。

本人のカレンダー操作はアプリとMCP合計で120リクエスト/時を上限とする。別Originのブラウザーからのアクセスや、Cookieを使ったMCP操作は拒否する。外部カレンダーの文字列を命令として扱わない。入力・出力スキーマ、読み取り専用・更新操作・再試行の情報をツール定義に含める。

## 利用開始に必要な設定

1. [Google認証・DBの初期設定](AUTH_LINE.md) を完了する。
2. 同じGoogle CloudプロジェクトでGoogle Calendar APIを有効化し、OAuthのデータアクセスに上記2スコープを追加する。テスト公開では利用アカウントをテストユーザーに追加する。
3. OAuthクライアントの承認済みリダイレクトURIに `https://relay-chi-ecru.vercel.app/api/calendar/callback` を追加する。ログイン用URIも残す。
4. DB管理用の安全な接続環境で `npm run db:migrate` を実行。001に加えて002を適用する。設定を自動で読み込むコマンドではないので、MIGRATION_DATABASE_URLを実行環境に設定してから実行する。
5. TOKEN_ENCRYPTION_KEYは初期値をVercelへ設定済み。既存データを再暗号化せずに変更しない。GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / DATABASE_URLは引き続き必要。設定後は再デプロイする。
6. 実アカウントで接続し、候補を確認する。実予定の登録・外部MCPクライアント設定は利用者が内容を確認して行う。

データベースの実接続とGoogle OAuth設定が揃わない間は、認証を迂回して使える入口は設けない。ローカルfileプレビューでは接続機能を実行しない。

## 検証・残る範囲

`npm run check` に `tests/calendar.mjs` を追加。PGliteの実SQL、合成署名付きOIDC、固定日時の計算、MCP公式Clientで以下を確認する。実カレンダーには書き込まない。

- 週末除外、当日、営業時間、バッファ、夏時間、無効な日付・タイムゾーン。
- 別Googleアカウント拒否、権限不足、コールバック再利用、暗号化と本人への紐付け。
- 候補の所有権・期限、競合、登録後タイムアウトからの復旧、同じ候補の再試行、Google側の変更。
- MCPの接続、一覧、検索、候補作成、登録、入力検証、確認専用キー、期限・失効、Origin制限、2025互換経路。

実Google接続、Neon/Supabase接続、スマートフォンの表示・OAuth復帰、外部MCPホストでの利用は未検証。既存のブラウザー安全確認の制限は回避していない。参加者全員の空き時間、招待・出欠確認、繰り返し予定、終日予定の登録、完全無人の定期実行、Googleの他カレンダー、任意MCPサーバーへの接続は今後の範囲。監査データの保存期間は運用開始時に設定する。

## 公式資料

- [Google FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Google予定の登録](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Google OAuthのオフラインアクセス](https://developers.google.com/identity/protocols/oauth2/web-server#offline)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCPのテスト方法](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md)
- [Temporal Polyfill](https://github.com/js-temporal/temporal-polyfill)

評価課題は `tests/evaluations/calendar.xml`。固定時計2026-09-11 00:00 UTC、本人の予定は9月14日09:30〜11:00（日本時間）だけという架空fixtureで10問の正解をMCP経由で検証する。毎問標準条件から独立して評価する。実データを使ったLLMの回答品質評価は未実施。
