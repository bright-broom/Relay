# Relayの推奨スタックと刷新順序

2026-09-11 / アーキテクチャ提案 / Next.js・DBは本番導入前の選定段階

## 結論

Relayの現時点の要件には、**TypeScript + React + Next.js App Router + Tailwind CSS + shadcn/ui、データ基盤はSupabase** を推奨する。言語はTypeScriptへ統一し、画面・計算・入力検証・バックグラウンド処理で型を共有する。

UIを美しくするためにライブラリを増やすのではなく、実績ある操作部品を利用し、見た目をRelayのトークンへ統合する。デザイン品質と依存パッケージ数は別に評価する。

## 推奨構成

| 領域 | 推奨 | 理由 |
|---|---|---|
| 言語 | TypeScript strict | 計算の単位、金額、状態遷移、API境界を明確にする |
| ランタイム | Vercelが対応する保守中のNode.js LTS | 最新安定版という方針と、長期運用の保守性を両立する |
| UI | React | 案件表、入力、比較、根拠パネルを部品として管理 |
| アプリ基盤 | Next.js App Router | 画面・認証連携・サーバーAPI・Webhookを一つの配置単位にまとめる |
| スタイル | Tailwind CSS + 中央デザイントークン | utilityはトークンの参照口。任意の色や寸法の直書きはしない |
| 共通部品 | shadcn/ui、導入時に選んだ一つのプリミティブ体系 | ソースを所有して外観調整できる。異なるダイアログや選択部品体系を無目的に混在させない |
| 一覧 | TanStack Table、必要時にVirtual | ソート・選択・列定義を管理。少数行から仮想化はしない |
| 入力 | React Hook Form + Zod | 入力状態とスキーマ検証。サーバーでも検証する |
| 多言語 | Next.jsならnext-intl | 翻訳キー、変数、複数形、日付・金額を統一。Next.js不採用ならi18next等へ変更 |
| DB・認証・ファイル | Supabase Postgres / Auth / Storage | 初期から必要な組織権限、添付資料、ログインをまとめられる |
| DB操作 | Supabase SDK + DB由来の型、SQL migration | 初期にORMとSDKの二重経路を作らず、変更の正本を一つにする |
| 非同期 | Inngest | 会話取込、分割抽出、再試行、定時確認。常駐処理をHTTP要求に押し込めない |
| 計算 | decimal.js + 自社の純粋な計算モジュール | 十進精度と丸めを明示。金融・業務ルールは自社仕様として検証 |
| 検証 | Vitest + Testing Library + Playwright | 計算・状態遷移・権限と代表的な操作フローを分担 |

React・Next.js・Tailwind等の具体的な最新パッチと互換性は、移行の実装日に公式情報・依存条件・ビルドで照合してlockfileへ固定する。最新の番号を組み合わせただけで動作保証とはしない。Canary/RCを「最新」の意味で本番採用しない。

今回導入したTypeScriptとesbuildは画面サンプルの型検査・配布用ビルドに使用する。React、Next.js、Tailwind、認証、DBはまだ導入していない。

## Next.jsを推す理由と、不採用でもよい条件

RelayはSEOより、サーバー側で扱う業務が判断材料になる。AIの秘密鍵、Webhook、取込ジョブ、権限を伴う更新、外部連携の認可を扱うため、Vercel上で画面とAPIをまとめられるNext.jsを初期候補とする。

Server Componentsは最初の表示やサーバーからの読取に使い、一覧の操作、編集、シミュレーションはClient Componentsにする。すべてをサーバー描画にする必要はない。SSRそのものを目標にせず、ユーザーの操作を軽くする境界を選ぶ。[Next.js Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

認証後のデータを組織横断の共有キャッシュに置かず、書込時に必ず権限を再確認する。Server Actionsに業務ロジックを直接埋め込まず、型付きのアプリケーション関数を呼ぶ。将来別クライアントから使うAPIやWebhookはRoute Handlerで提供する。

**React + Viteが適する条件**：別のバックエンドが確定している、完全なSPAとして配布したい、クライアント側の編集・オフライン動作を中心に据える場合。Vercelにも配置できるが、API、認証のサーバー側処理、ジョブ、ルーティングを別途組み合わせる。[Vite Backend Integration](https://vite.dev/guide/backend-integration)

Vercelで動かすからNext.jsが必須というわけではない。今の未確定条件なら、Next.jsを第一案として保ち、画面・計算・データアクセスを分離して選択肢を残す。

## SupabaseとNeonの比較

| 判断軸 | Supabase | Neon |
|---|---|---|
| 中心 | PostgresとAuth・Storage等の基盤をまとめる | サーバーレスPostgresとDBブランチを中心に構成する |
| Relayの初期開発 | 認証・添付資料・DB権限を一体で設計しやすい | DBに加え、認証・ファイル保管等の構成を明確に選ぶ |
| Preview | 本番と分離したデータ・認証・Storageの設計が必要 | DBブランチが開発環境に有用。秘密情報や個人情報の複製範囲を別途制御 |
| 認証 | Supabase Authを使う構成 | Neon Authも選択肢。認証が存在しないサービスとして扱わない |
| 採用条件 | 小さなチームで全体の接続・運用負荷を抑える | DBブランチを重視し、認証・Storageの組合せを独立して選びたい |

Relayは会話と添付資料が中核なので、**最初はSupabaseを推奨**する。Neonが劣るという判断ではなく、運用する構成要素を減らすための選択。料金の優劣は容量、接続、稼働時間、認証ユーザー、ファイル転送の実測なしに断定しない。[Supabase Architecture](https://supabase.com/docs/guides/getting-started/architecture)、[Neon Authとブランチ](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)

どちらもPostgresだが、Auth・Storage・Realtimeまで使った後の移行はDBの接続先変更だけでは完了しない。UIからDB SDKを直接呼び散らさず、案件・証拠・ジョブ等の用途別アクセス境界を設ける。SupabaseではRLSを適用し、service roleを使用するジョブでも組織と対象IDの所属を検証する。

Neonに変更するなら、Drizzle等でスキーマ・型・migrationを統一する案を再評価する。初期から二つのDBを並行稼働させない。

## シミュレーションの設計

JavaScriptの二進浮動小数点による誤差を避けたい金額計算ではdecimal.jsを使用する。金額・金利・期間・単位・丸め規則を型付きの入力にし、文字列のまま受けた数値を検証してから変換する。[decimal.js](https://mikemcl.github.io/decimal.js/)

計算式は純粋関数としてUI、DB、LLMから独立させる。表示用の丸めと計算途中の精度は分離する。0%金利、期間0、途中返済、欠損、通貨の小数桁、非常に大きい値を検証する。ライブラリが業務上の正しさまで保証するとは扱わない。

軽い試算はブラウザーで即時実行できる。正式に保存する結果は同じ計算モジュールでサーバー再計算し、入力・計算バージョン・前提と一緒に保存する。重い処理になってからWeb Workerやバックグラウンド処理を導入する。

## デザイン変更と刷新の順序

**デザインの仕様を先に固め、完成版のUI実装は新スタック上で行う。**

1. トークン、情報階層、共通部品、代表画面を決める。
2. 今回のサンプルで全画面の方向性と操作の流れを確認する。
3. Next.jsまたはVite、DB、国際化ライブラリを選定する。
4. 新スタックへトークン・翻訳リソース・データ型を移し、共通部品を実装する。
5. 一覧・詳細・更新案を縦に完成させ、認証とDBの実際の状態に接続する。
6. 残りの画面、取込、非同期AI処理を順に移す。

旧HTMLを本番品質まで作り込み、その後すべてReactで書き直すと、DOM制御・フォーム・ルーティング・検証が二重になる。今回は全画面のデザイン検討に範囲を限定し、フレームワークに依存しない成果物を分離する。

### 今回再利用できるもの

- `src/design/tokens.ts`：色、余白、文字、寸法、動き、ブレークポイント。
- `src/i18n/messages.ts`：日本語・英語のUI文言と型付きキー。採用i18nライブラリの形式へ変換する。
- `src/prototype/data.ts`：案件の型と架空データ。実際のドメインモデルへ拡張する。
- レイアウト、根拠表示、更新案の差分、例外状態の設計。

再利用しないもの：文字列テンプレートによるDOM描画、サンプル内の状態保存、静的なルーティング。この部分はReactの部品・状態管理と本番の永続化へ置き換える。

## CI/CDと依存の方針

公開リポジトリには架空データのみを置く。公開であることだけでVercelやDBの利用が無料になるとは扱わない。CIとデプロイの課金・無料枠は別に管理する。

本番のCIは、ソース変更時に型検査・lint・影響するテストを実行し、ドキュメントだけなら重いビルドを省く。同ブランチの古い実行はキャンセルする。ブラウザーテストは主要経路へ絞り、DBとAIを使う統合テストは必要な実行に限定する。

Tailwindはテーマ変数へトークンを接続し、任意値utilityを乱用しない。shadcn/uiの見た目も同じ変数へ揃える。TanStack Query、グラフ、アニメーション等は必要になった機能から追加し、似た役割のライブラリを重複させない。[Tailwind Theme Variables](https://tailwindcss.com/docs/theme)、[shadcn/ui](https://ui.shadcn.com/docs)、[next-intl](https://next-intl.dev/docs/getting-started)
