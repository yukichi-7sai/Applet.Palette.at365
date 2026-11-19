# Paletteの開発

[利用仕様](docs/usage.md) / [共通Applet API](../AppDock.at365/docs/extensions.md) / [入力パレットAPI](../AppDock.at365/docs/input-palettes.md) / [設定provider](../AppDock.at365/docs/applet-providers.md) / [ファイルStorage](../AppDock.at365/docs/storage-files.md) / [共通テスト](../AppDock.at365/docs/test-runtime.md)

Node Applet。依存パッケージやビルドは不要。`index.cjs`が`palette.cjs`の実行インスタンスを公開する。

小窓の描画と左右キーでの切り替えは`ui/`に置く。`palette.cjs`は次に開く時点で有効な画面を`context.inputPalette.openPopup`に渡す。本体は小窓の表示、元の入力先とキーの捕捉、Windows履歴の取得、貼り付けを担当する。

定型文の設定UIは共通providerの一覧・編集・削除確認・並べ替えを使用し、登録内容はStorage APIで保存する。providerの予約キー`snippetStorage`へ本文や登録一覧を保存しない。動作設定は通常のSettings APIで扱う。

## 検証

AppDockの固定Nodeを使って`node --test tests/*.test.cjs`を実行する。固定EXEの設定・保存・パレット試験は`scripts/palette-ui-test.cjs <AppDock.at365.exeの絶対パス> <AppDockソースroot>`を使う。結果と隔離profileは自身の`.artifacts`に保存する。

## 発行

`publish.bat`は共通publish resolverと共通Appletパッカーで、実行用フォルダーと`update.zip`・`update.json`を生成する。別の本体checkoutを使う場合は`publish.bat -HostRoot <AppDockソースroot>`を指定する。発行先はGit管理外の`publish.local.json`で解決し、実利用先への配置や外部公開は別工程とする。
