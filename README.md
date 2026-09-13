# Relay

**会話から、次の行動へ。**

Relayは、日々の会話や活動から情報を整理し、案件の進行と引き継ぎを支援するAI業務基盤です。営業を入口に、事務・運用・顧客サポートまで幅広い職種へ展開することを目指します。

## 現在の状態

案件画面は架空データのプロトタイプです。Googleホワイトリスト認証とLINE個人・グループ通知の接続基盤を実装しました。利用開始にはOAuth・PostgreSQL・Messaging APIの接続設定が必要です。案件のサーバー同期・AI接続・自動期限通知は未実装です。

- [Google認証・LINE通知の設定](docs/AUTH_LINE.md)
- [Googleカレンダー・MCPの日程調整](docs/CALENDAR_MCP.md)

- [プロダクト・システム設計](docs/DESIGN.md)
- [開発要件](docs/DEVELOPMENT.md)
- [デザインガイド](docs/DESIGN_GUIDELINES.md)
- [推奨スタックと刷新順序](docs/STACK_DECISION.md)
- [画面サンプル](prototype/index.html)
- [確認状況](docs/VALIDATION.md)

## 料金シミュレーション

左サイドバーの電卓アイコンから、導入前後の月額・初期費用・分割払いを比較できます。顧客向け提示モードと計算根拠を備えます。現在は税込JPY・一定月額の概算で、保存や業界固有の融資計算は未対応です。[仕様と検証範囲](docs/PRICING.md)。

## 画面サンプル

架空データによる案件一覧・更新案の確認・対応記録・タスク完了・引き継ぎ文作成を試せます。記録と下書きはこの端末のブラウザーへ保存します。情報メニューからサンプルを初期化できます。

iOS / Android向けのホーム画面アプリ（PWA）に対応。[公開版を開く](https://relay-brightbroom.vercel.app/)。SafariまたはChromeから追加します。`prototype/index.html` をファイルとして開く場合はインストール・オフライン機能を利用できません。[導入と検証手順](docs/MOBILE_APP.md)

画面サンプルはデザインガイドに沿って刷新しました。白・黒・グレーと青い主要操作、専用の案件詳細画面、共通i18nとLucideアイコンを備えます。言語設定は左サイドバーから変更でき、日本語・英語以外は英語へフォールバックします。[国際化・操作部品の仕様](docs/I18N_UX.md)。業務データ・元の発言は架空の日本語データのまま表示します。

TypeScriptのソースは `src/prototype/`、スタイルの値は `src/design/tokens.ts`、UI文言は `src/i18n/locales/` で管理します。`prototype/assets/` は生成物です。直接編集しないでください。

```sh
npm ci
npm run check
```

`npm run build` で配布用の画面を更新します。生成物はそのままブラウザーで開けるようコミットしています。今回のビルドにReact・Next.js・Tailwind・DBは含みません。本番UIでは採用したフレームワークで描画部分を置き換えます。

## 本番の想定構成

Next.js / TypeScript + Vercel、Supabase、Inngest、LLM API。詳細は設計書を参照してください。

## 公開方針

初期はCI/CDの無料枠を節約するため、公開リポジトリとして運用します。顧客情報・業務会話・秘密鍵・個人の環境設定はコミットせず、Previewには架空データを使います。

## 共通UI

2026-09-13に全画面をReact＋shadcn/ui＋lucide-reactへ移行。構成・置換範囲・検証は[共通部品](docs/COMPONENTS.md)を参照。

Google認証付き管理者ページ：[`/admin`の仕様・設定](docs/ADMIN.md)。
