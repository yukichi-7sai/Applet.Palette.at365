# Paletteの検証

## 2026-11-19 定型文一覧の並べ替え

AppDock 0.268.10の発行EXEとPalette 0.2.0で、定型文を一覧内で下へ動かしてキャンセルし、保存済みファイルのバイト列が一致することを確認。単体7件と隔離GUIの4項目が成功した。実行記録は `.artifacts/palette-ui-8rWi6y/result.json`。

## 2026-11-18 Palette 0.2.0

- Applet名、ID、コマンドID、設定・Storageの参照、翻訳、配布元、同梱ファイル名の綴りを確認した。Applet IDとコマンドIDの変更によりマイナー版を更新した。最低ホスト版は0.255.0。
- 単体7件が成功。AppDock 0.268.2の発行EXEを隔離プロファイルで起動し、Paletteの表示名、新しいコマンドID、パレットからの設定遷移、定型文の保存・再起動、Applet停止を確認した。Windowsの実履歴と一般アプリへの貼り付けは今回の確認範囲外。
- ローカル発行のmanifest・実行ファイル・翻訳をZIP内の4ファイルと照合し、更新feedのID、版、サイズ、SHA-256が一致した。試験ログと配布照合は `.artifacts/palette-initial/`、固定EXE試験は `.artifacts/palette-ui-liC92v/` に保存した。
