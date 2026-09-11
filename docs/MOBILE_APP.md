# Relay モバイルアプリ

iOS / Android共通のPWA。アプリストア向けの署名済みバイナリではなく、公開URLからホーム画面へ追加する方式。App Store / Google Playへの申請は今回の範囲に含まない。

公開URL：https://relay-brightbroom.vercel.app/

## 導入

- iPhone / iPad：Safariで公開URLを開く → 共有 → ホーム画面に追加 → 追加。「Webアプリとして開く」が表示される場合はオン。
- Android：Chromeで公開URLを開く → メニュー → アプリをインストール、またはホーム画面に追加。対応時はアプリ内の追加ボタンからもインストール画面を開ける。
- ローカルの `file://` ではインストールできない。Vercel等のHTTPSが必要。

参考：[Appleの追加手順](https://support.apple.com/en-euro/guide/iphone/iphea86e5236/ios)、[WebKitのホーム画面アプリ](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)、[GoogleのPWA導入ガイド](https://web.dev/learn/pwa/installation)。メニュー表記はOS・ブラウザーの版と表示言語で異なる。

## 動作とデータ

- オフライン：最初のオンライン読み込みとキャッシュ準備の完了後に利用できる。対象はHTML・CSS・JavaScript・アイコン等のアプリ本体のみ。APIや任意の外部コンテンツはキャッシュしない。
- 保存：架空案件の記録、更新案の反映状態、下書き、表示言語を端末内へ保存。別端末や別ブラウザーへの同期は未接続。ブラウザーデータの削除は記録の削除を伴う。機密情報の保存基盤としては使わない。
- 初期化：情報アイコン → サンプルを初期化。確認後に、このブラウザーのデモ記録と下書きを削除する。
- 更新：新しいアプリ本体はバックグラウンドで準備し、古いアプリを開いている間は強制切り替えしない。すべてのRelay画面を閉じて再度開くと新しい版へ切り替わる。端末内記録は保持する。
- 対応コードの出力対象はSafari 16 / Chrome 110以降。これはコンパイル対象であり、すべての該当端末を実機検証済みという意味ではない。

## 配置

`npm run build` で `prototype/` に生成。Vercelは `vercel.json` の `buildCommand` と `outputDirectory` を使用する。Service Workerとmanifestに再検証用の配信設定を付ける。

HTMLの正本：`src/prototype/index.html`。PWA処理：`src/pwa/`。端末内保存：`src/prototype/storage.ts`。アイコン・manifest・Worker生成：`scripts/pwa.mjs`。生成物は直接編集しない。

## 実機での受入確認（未実施）

1. iPhone SafariとAndroid Chromeで公開URLからホーム画面へ追加し、独立したウィンドウで起動する。
2. 選択式の記録と任意メモを保存し、アプリを閉じて再度開いて復元を確認する。
3. 初回読み込み完了後に機内モードへ切り替え、再起動・画面移動・記録保存を確認する。
4. ノッチ・ホームインジケーター・横向き・ソフトウェアキーボード・200%拡大時の操作を確認する。
5. 版を更新し、編集中の画面が強制再読込されないこと、全画面を閉じた後に新版へ切り替わることを確認する。
