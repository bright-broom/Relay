# Relay モバイルアプリ

iOS / Android共通のPWA。アプリストア向けの署名済みバイナリではなく、公開URLからホーム画面へ追加する方式。App Store / Google Playへの申請は今回の範囲に含まない。

公開URL：https://relay-brightbroom.vercel.app/

## 導入

- iPhone / iPad：Safariで公開URLを開く → 共有 → ホーム画面に追加 → 追加。「Webアプリとして開く」が表示される場合はオン。
- Android：Chromeで公開URLを開く → メニュー → アプリをインストール、またはホーム画面に追加。アプリ内の追加ボタン・案内は設けない。
- ローカルの `file://` ではインストールできない。Vercel等のHTTPSが必要。

参考：[Appleの追加手順](https://support.apple.com/en-euro/guide/iphone/iphea86e5236/ios)、[WebKitのホーム画面アプリ](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)、[GoogleのPWA導入ガイド](https://web.dev/learn/pwa/installation)。メニュー表記はOS・ブラウザーの版と表示言語で異なる。

## 動作とデータ

- オフライン：認証導入に伴い停止。起動・復帰にはオンラインでのログイン確認が必要。古いRelayキャッシュは新しいWorkerで削除する。
- 保存：架空案件の記録、更新案の反映状態、下書き、表示言語を端末内へ保存。別端末や別ブラウザーへの同期は未接続。ブラウザーデータの削除は記録の削除を伴う。機密情報の保存基盤としては使わない。
- 初期化：情報アイコン → サンプルを初期化。確認後に、このブラウザーのデモ記録と下書きを削除する。
- 更新：認証導入時は旧キャッシュの廃止とともに一度再読み込みする。端末内デモ記録はログアウト・アカウント切替時に削除する。詳細は [認証・LINE](AUTH_LINE.md)。
- 対応コードの出力対象はSafari 16 / Chrome 110以降。これはコンパイル対象であり、すべての該当端末を実機検証済みという意味ではない。

## 配置

`npm run build` で `prototype/` にプレビューを生成し、公開可能な素材だけを `public/` にコピーする。Vercelの静的配信は `public/`。アプリHTML/本体JSはFunctionから認証後に返す。Service Workerとmanifestに再検証用の配信設定を付ける。

HTMLの正本：`src/prototype/index.html`。PWA処理：`src/pwa/`。端末内保存：`src/prototype/storage.ts`。アイコン・manifest・Worker生成：`scripts/pwa.mjs`。生成物は直接編集しない。

## 実機での受入確認（未実施）

1. iPhone SafariとAndroid Chromeで公開URLからホーム画面へ追加し、独立したウィンドウで起動する。
2. 選択式の記録と任意メモを保存し、アプリを閉じて再度開いて復元を確認する。
3. 機内モードでは認証を迂回してアプリが起動しないことを確認する。
4. ノッチ・ホームインジケーター・横向き・ソフトウェアキーボード・200%拡大時の操作を確認する。
5. 旧PWAから更新し、旧キャッシュの削除・再読み込み・ログイン要求を確認する。
