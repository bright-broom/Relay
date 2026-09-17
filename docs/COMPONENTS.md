# Relay 共通部品とReact移行

2026-09-13 / UI構成 v0.3

全画面の描画をReactへ移し、shadcn/uiの部品とlucide-reactへ統一した。文字列HTML、全画面のinnerHTML差し替え、document全体へのクリック委譲は廃止。料金計算・認証・カレンダーのサーバー側の契約は変更しない。

## 置換範囲

| 用途 | 共通部品 |
|---|---|
| 操作・アイコン操作・ナビゲーション | Button / Tooltip |
| 金額・日付・自由入力・メモ | Input / Textarea / Label |
| 担当・状態・期間・言語・通知先 | Native Select |
| 料金条件の確認 | Checkbox |
| 料金・日程・アカウント・言語・引き継ぎ | Dialog |
| サンプルデータのリセット確認 | Alert Dialog |
| 補足・履歴・詳細条件 | Collapsible |
| 案件カード・入力領域 | Card |
| 案件一覧表 | Table |
| 状態・期限 | Badge |
| 読み込み・エラー・操作結果 | Alert |
| 意味を持つ操作アイコン | lucide-react |

選択はshadcn/uiのNative Selectを採用し、OSの選択操作とキーボードを維持する。日付はInputのtype=dateでOSの日付選択を使う。ログイン画面だけはJavaScriptなしの言語変更を維持するため、折りたたみにHTMLのdetailsを残す。一般のリンク・見出し・業務データのリスト、レイアウト、PWAのブランド画像は役割に合う標準HTML／既存トークンを使用する。左メニューはスマートフォンでも常設するため、非表示になるモバイルメニューへ変更しない。

## ソースと依存関係

- `src/components/ui/`：shadcn CLI 4.21.0、new-yorkレジストリから取得した14部品。ソース所有型の導入であり、shadcnという実行時パッケージは不要。
- `src/ui/controls.tsx`：翻訳済み操作名、Lucide、標準候補と直接入力、折りたたみ、通知を共通化。
- `src/ui/icons.tsx`：操作の意味とlucide-reactの名前付きインポート。古いLucideのSVG文字列生成器を削除。
- `src/app/`：全画面のReact描画、画面状態、連携APIの呼び出し。料金・日程・アカウントは分離。
- `src/app/store.ts`：既存の端末保存形式を継承。保存失敗・他ウィンドウとの競合で入力を消さず、保存成功と表示しない。
- `src/server/page.tsx`：Googleログイン画面をReactで静的描画。同じLanguageFormとshadcn入力部品を使用。
- `src/design/tokens.ts`：色・寸法・階層の正本。`src/design/components.css`でTailwindへ接続し、`src/prototype/styles.css`で意味付き部品へ適用。

導入時のnpm公式レジストリでReact / React DOM 19.3.0、Tailwind CSS 4.3.3、lucide-react 1.45.0を確認して固定。Radix UIは1.6.7。TypeScriptと既存の計算ライブラリは継続使用。依存関係の再現はpackage-lock.jsonに従う。

shadcn標準の色・寸法・ダークテーマをそのまま重ねず、Relayの墨黒・白・青と既存のタッチ領域へ接続した。Radixのフォーカス制御・Escape・ポータル・チェック状態、shadcnの型と合成方法は保持する。`asChild`によるdata-slotの上書きにも影響されないよう、ボタンの見た目は意味付きクラスで指定する。外部ライブラリがフォーカス制御等のために実行時生成するstyleは、アプリによるデザイン値の直書きとは区別する。

レジストリを再取得して上書きする場合は、トークン適用・Closeの翻訳・各共通部品の操作テストを比較する。出典ライセンスは`licenses/shadcn-ui.txt`。

## 引き継いだ動作

- 下書き・選択状態をReactで制御し、再描画で入力を消さない。折りたたみ内部も保持する。
- 料金入力・出典・提示はメモリー内のみ。閉じたら破棄。費用や出典を変更すると確認を解除する。
- 支払い計算と500通りの独立した明細照合を維持する。
- 同意・返答待ちだけで業務を完了にしない。完了結果と完了保存を明示的に選択する。
- 日程条件の変更で古い候補を消す。APIの二重操作を防ぎ、通信失敗後も条件を保持する。
- 公開静的ファイルと認証が必要なアプリを引き続き分離。実Google・LINE・DBの設定は別の利用開始条件。

## 検証

`npm run check`で型・ビルド・文言／CSS監査・認証／LINE・カレンダー／MCP・計算・国際化を確認する。`test:ui`はjsdomとReact Testing Libraryで、架空データとモックAPIだけを使う。料金の確認ゲート、分割金額の保持、提示終了、DialogのEscapeとフォーカス復帰、RTL、保存失敗、日程変更、LINE通知先の保持を操作して確認する。

このテストはブラウザーによる見た目・タッチ操作の証拠ではない。ローカル画面のブラウザーアクセス制限は回避していない。390 / 768 / 1440pxの実表示、スマートフォン実機、実Google／LINE連携は未検証。

公式資料：[shadcn導入](https://ui.shadcn.com/docs/installation/manual)、[Native Select](https://ui.shadcn.com/docs/components/native-select)、[Lucide React](https://lucide.dev/guide/react)、[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)。

## 端末幅への適応

全ページ・共通ダイアログのレスポンシブ仕様は [RESPONSIVE.md](RESPONSIVE.md) を参照。ウィンドウ幅による余白と、コンテンツの実幅による段組みを分離した。ダイアログ内のスクロール、キーボード、ピンチ拡大は共通基盤で扱う。

## 2026-09-17 未使用部品の整理

レジストリに含まれていた未使用の Card 子部品、Dialog の補助部品、Alert の見出し・説明、Native Select の OptGroup、Table の Footer / Caption など 17 関数を削除した。利用中の Overlay / Portal と variant の実装は必要な範囲だけをモジュール内に残す。使用されていない variant、閉じるボタンの代替実装、空の className も整理した。画面が使用する閉じる操作、フォーカス復帰、確認ダイアログ、読み上げ名は維持する。

共通部品はこのアプリが使う範囲の API を持つ。将来の用途だけを理由に、未使用のレジストリ部品を一括復元しない。再導入時は呼び出し元、Relay のトークン、翻訳、アクセシビリティを合わせて確認する。

今回の整理後に npm run check と実 PostgreSQL の検証は成功。追加監査は未使用ファイル・未使用 export・孤立 HTML・古い生成ファイルを注入したときに拒否することも確認した。ブラウザーでは公開デモの起動を確認したが、その後の確認ツールの接続タイムアウトにより、390 / 768 / 1440 px の新たな目視確認は完了していない。ダイアログ・フォーカス復帰・RTL・入力保持は既存の DOM 回帰テストで確認した。

## 機能単位の遅延読み込み

`src/app/features.ts` が 5 機能の遅延 import と操作意図に応じた先読みを共有する。`src/app/feature-boundary.tsx` は既存の Notice / Action を使い、読み込み・失敗・再読み込みを日英で案内する。ナビゲーションと Dialog の見出し・閉じる操作は境界の外に置く。先読みでは画面をマウントせず、API を呼び出さない。[設計と検証範囲](PERFORMANCE.md)を参照。

## ポップアップの背景クリック（2026-09-17）

料金・日程・表示言語・デモ情報・引き継ぎは、背景クリックで閉じる。共通の Dialog で外側操作を禁止していた設定を解除し、Radix のフォーカス制御と Escape を維持した。内部のクリックでは閉じず、閉じた後は開いたボタンへフォーカスを戻す。料金の入力は既存どおり、閉じると破棄する。

初期化・アーカイブの AlertDialog も、背景クリックをキャンセルとして扱う。共通部品の開閉状態を通じて閉じるだけで、実行ボタンの処理を呼ばない。重なった確認は手前だけを閉じ、親のウィンドウを残す。Radix の確認画面の意味・初期キャンセルフォーカス・明示的な実行ボタンは維持する。制御／非制御の open に対応する。

全 5 ウィンドウ、内部クリック、フォーカス復帰、重なった初期化のキャンセル、アーカイブの非実行を DOM テストで確認。通常画面と確認画面を旧実装に戻すと、それぞれの新しい回帰テストが失敗することも確認した。ローカルの実ブラウザーでは 390 px の料金表示・入力・Escape、768 px の料金の背景クリック、1440 px の確認画面と親画面を順番に背景で閉じる操作を確認し、コンソールエラーは 0 件。390 px の料金画面は従来どおり全画面表示のため、露出した背景はなく、閉じるボタン／Escape を使う。実機のタッチ操作は未検証。

共通部品の API は [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) と [AlertDialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog) を参照。
