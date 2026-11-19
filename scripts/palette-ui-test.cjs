const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const hostRoot = path.resolve(process.argv[3] || "../AppDock.at365");
const source = process.argv[2];
if (!source || !path.isAbsolute(source))
  throw Error("Pass a sealed AppDock EXE and its source root");
const { launch, until } = require(
  path.join(hostRoot, "scripts/page-test-host.cjs"),
);
const { settingsPage } = require(
  path.join(hostRoot, "scripts/settings-host-helper.cjs"),
);
const { settleSettings } = require(
  path.join(hostRoot, "scripts/settings-immediate-helper.cjs"),
);
const { overlayPage, overlayClosed } = require(
  path.join(hostRoot, "scripts/shell-overlay-helper.cjs"),
);
const artifacts = path.join(root, ".artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, "palette-ui-"));
const settings = require(
  path.join(hostRoot, "out/main/shared/settings-schema"),
).createDefaultSettings();
settings.host.closeToTray = false;
Object.assign(settings.updates, {
  checkHostOnStartup: false,
  checkAppletsOnStartup: false,
  checkHostOnAboutOpen: false,
});
settings.extensions["at365.palette"] = require("./fixture.cjs").install(profile);
fs.writeFileSync(
  require(path.join(hostRoot, "scripts/test-settings.cjs")).file(profile),
  JSON.stringify(settings),
);
const storage = path.join(
  profile,
  "data/storage/at365.palette/shared/files/snippets.json",
);
const read = (file = storage) => JSON.parse(fs.readFileSync(file, "utf8"));
const table = "provider:snippets:snippets";
const checks = [];
let host,
  success = false;
const dialog = () => host.main.locator("dialog[open]").last();
const item = (key) =>
  host.main.locator(
    '[data-setting-item="' +
      encodeURIComponent("applet:at365.palette") +
      "/" +
      encodeURIComponent("setting:" + key) +
      '"]',
  );
const field = (key) => item(key).locator("input");
const usePalette = (key) => item(key).getByRole("switch", { name: "パレットを使う" });
const popupPath = "/extensions/at365.palette/ui/input-palette.html";
const openPalette = (kind) => host.main.evaluate((kind) =>
  window.dock.executeCommand(`at365.palette.${kind}.open`), kind);
const snapshot = () => host.main.evaluate(() => window.dock.snapshot());
const navigate = async () => {
  await host.main.evaluate(() =>
    window.dock.executeCommand("appdock.settings.applet.at365.palette.open"),
  );
  await settingsPage(host.main);
  await host.main.getByRole("button", { name: "定型文", exact: true }).click();
  await host.main.getByTestId(table + ":add").waitFor();
};
async function add(name, text) {
  await host.main.getByTestId(table + ":add").click();
  await dialog().getByLabel("名前", { exact: true }).fill(name);
  await dialog().getByLabel("本文", { exact: true }).fill(text);
  await dialog().getByRole("button", { name: "OK", exact: true }).click();
  await until(
    async () => (await host.main.locator("dialog[open]").count()) === 0,
    "dialog saved",
  );
}
(async () => {
  try {
    host = await launch(profile, source, {}, artifacts);
    await navigate();
    const applet = (await snapshot()).extensions.find(
      ({ id }) => id === "at365.palette",
    );
    assert.equal(applet?.displayName, "Palette");
    assert.equal(
      await host.main.getByTestId("settings-nav:text-palette").count(),
      0,
    );
    for (const id of ['appdock.text-palette.open', 'appdock.clipboard-history.open']) {
      const rejected = await host.main.evaluate(async id => {
        try { await window.dock.executeCommand(id); return false; } catch { return true; }
      }, id);
      assert(rejected, 'Retired built-in command is unavailable');
    }
    await host.main.getByTestId(table + ":add").click();
    await dialog().getByLabel("名前", { exact: true }).fill("cancelled");
    await dialog().getByLabel("本文", { exact: true }).fill("not saved");
    await dialog()
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    assert(!fs.existsSync(storage));
    const body = "palette-body-marker\n日本語と絵文字😀\n{{literal}}";
    await add("挨拶", body);
    await until(
      () => fs.existsSync(storage) && read().items.length === 1,
      "Storage registration",
    );
    assert.equal(read().items[0].text, body);
    const first = read().items[0].id;
    await add("二番目", "second-body-marker");
    await until(() => read().items.length === 2, "second registration");
    await add("削除用", "delete-body-marker");
    await until(() => read().items.length === 3, "deletion fixture");
    const removedId = read().items.at(-1).id;
    await host.main.getByTestId(table + ":list:delete:" + removedId).click();
    await dialog().getByText("「削除用」を削除しますか？", { exact: true }).waitFor();
    await dialog().getByRole("button", { name: "キャンセル", exact: true }).click();
    assert.equal(read().items.length, 3);
    await host.main.getByTestId(table + ":list:delete:" + removedId).click();
    await dialog().getByRole("button", { name: "OK", exact: true }).click();
    await until(() => read().items.length === 2, "confirmed deletion");
    await host.main.getByTestId(table + ":list:edit:" + first).click();
    assert.equal(
      await dialog().getByLabel("本文", { exact: true }).inputValue(),
      body,
    );
    await dialog().getByLabel("名前", { exact: true }).fill("変更した名前");
    await dialog().getByRole("button", { name: "OK", exact: true }).click();
    await until(
      () => read().items[0].name === "変更した名前",
      "edit persisted",
    );
    await host.main.getByTestId(table + ":list:toggle:" + first).click();
    await until(() => !read().items[0].enabled, "toggle persisted");
    await host.main.getByTestId(table + ":list:toggle:" + first).click();
    await until(() => read().items[0].enabled, "toggle restored");
    const bytes = fs.readFileSync(storage, "utf8");
    await host.main.getByTestId(table + ":list:order").click();
    const ordering = host.main.locator(".settings-inline-order");
    await ordering.getByTestId("settings-order-handle:" + first).press("ArrowDown");
    await ordering
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    assert.equal(fs.readFileSync(storage, "utf8"), bytes);
    const sharedSettings = fs.readFileSync(
      path.join(profile, "data/settings.json"),
      "utf8",
    );
    assert(
      !sharedSettings.includes("palette-body-marker") &&
        !sharedSettings.includes("second-body-marker"),
    );
    assert.equal(
      JSON.parse(sharedSettings).extensions["at365.palette"].settings
        .snippetStorage,
      undefined,
    );
    checks.push(
      "Inline add/edit/toggle/order cancellation persist only to Storage; full multiline Unicode text and stable IDs survive",
    );

    await host.main.getByRole("button", { name: "動作設定", exact: true }).click();
    const headingNames = ["クリップボード履歴", "定型文パレット"];
    const sections = host.main.locator("section.settings-section").filter({
      has: host.main.getByRole("heading", {
        name: /^(クリップボード履歴|定型文パレット)$/,
      }),
    });
    await sections.nth(1).waitFor();
    assert.deepEqual(await sections.locator("h2").allTextContents(), headingNames);
    for (const [index, kind] of ["history", "snippets"].entries()) {
      const id = `at365.palette.${kind}.open`;
      const title = index === 0 ? "クリップボード履歴パレット" : "定型文パレット";
      await sections.nth(index)
        .getByRole("button", {
          name: `${title}を開くをコマンドパレットで表示`,
          exact: true,
        })
        .click();
      const commandOverlay = await overlayPage(host.main);
      await commandOverlay
        .locator(`[role=option][data-command-id="${id}"][aria-selected=true]`)
        .waitFor();
      await commandOverlay.getByRole("combobox").press("Escape");
      await overlayClosed(host.main);
    }
    const snippetsTab = "setting:applet:at365.palette:provider:snippets:snippets";
    const snippetsLink = sections.nth(1).getByTestId("page-link:" + snippetsTab);
    assert.equal(await snippetsLink.innerText(), "定型文");
    await snippetsLink.press("Enter");
    await host.main.getByRole("table", { name: "定型文", exact: true }).waitFor();
    await until(() =>
      host.main.evaluate(() =>
        document.activeElement?.getAttribute("data-setting-item") ===
        "applet%3Aat365.palette/provider%3Asnippets%3Asnippets"),
      "focus moves to the snippets tab",
    );
    await host.main.getByRole("button", { name: "動作設定", exact: true }).click();
    checks.push(
      "History precedes snippets, both command links preselect their command, and Enter opens and focuses the snippets tab",
    );
    for (const key of ["snippetsEnabled", "historyEnabled"]) {
      assert.equal(await usePalette(key).getAttribute("aria-checked"), "true");
      await usePalette(key).click();
    }
    await settleSettings(host.main);
    await openPalette("snippets");
    await openPalette("history");
    assert(
      !await host.app.evaluate(({ BrowserWindow }, suffix) =>
        BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith(suffix)),
        popupPath),
    );
    await usePalette("snippetsEnabled").click();
    await settleSettings(host.main);
    assert.equal(await field("snippetWidth").inputValue(), "370");
    assert.equal(await field("historyWidth").inputValue(), "370");
    assert.equal(await field("snippetRows").inputValue(), "8");
    await field("snippetWidth").fill("480");
    await field("snippetWidth").press("Enter");
    await settleSettings(host.main);
    await host.save({
      extensionId: "at365.palette",
      settings: { includeHistory: false },
    });
    await host.main.bringToFront();
    await field("snippetRows").focus();
    await openPalette("snippets");
    let panel = await host.page(popupPath);
    await panel
      .locator('.choices [data-index="0"] strong')
      .filter({ hasText: "変更した名前" })
      .waitFor();
    assert.doesNotMatch(await panel.locator("footer").innerText(), /←→/);
    await panel.screenshot({ path: path.join(profile, "palette-single-view.png") });
    await panel
      .getByRole("button", { name: "Paletteの設定を開く", exact: true })
      .click();
    await settingsPage(host.main);
    await host.main.getByRole("button", { name: "定型文", exact: true }).waitFor();
    checks.push(
      "Real Applet command supplies candidates through the packaged host; management opens its own settings",
    );
    checks.push("Both switches default ON, both OFF keeps the popup closed, and a single view omits the horizontal guide");

    await navigate();
    await host.resize(900, 620);
    await host.main.getByRole("table", { name: "定型文", exact: true }).scrollIntoViewIfNeeded();
    await host.main.screenshot({
      path: path.join(profile, "snippets-narrow-light.png"),
    });
    await host.save({ host: { theme: "dark" } });
    await host.resize(1720, 1000);
    await host.main.getByRole("table", { name: "定型文", exact: true }).scrollIntoViewIfNeeded();
    await host.main.screenshot({
      path: path.join(profile, "snippets-wide-dark.png"),
    });
    await host.main.getByTestId("settings-storage-local").check();
    await until(
      async () =>
        (await host.main
          .locator('[data-testid^="' + table + ':list:row:"]')
          .count()) === 0,
      "device scope is empty",
    );
    assert.equal(fs.readFileSync(storage, "utf8"), bytes);
    await add("このPC", "device-body-marker");
    const deviceFile = fs
      .readdirSync(path.join(profile, "data/storage/at365.palette/devices"))
      .map((name) =>
        path.join(
          profile,
          "data/storage/at365.palette/devices",
          name,
          "files/snippets.json",
        ),
      )
      .find((file) => fs.existsSync(file));
    assert(deviceFile);
    assert.equal(read(deviceFile).items[0].text, "device-body-marker");
    assert.equal(fs.readFileSync(storage, "utf8"), bytes);
    await host.close();
    host = await launch(profile, source, {}, artifacts);
    await navigate();
    await host.main.getByText("このPC", { exact: true }).waitFor();
    await host.main.getByRole("button", { name: "動作設定", exact: true }).click();
    assert.equal(await field("snippetWidth").inputValue(), "480");
    assert.equal(await usePalette("snippetsEnabled").getAttribute("aria-checked"), "true");
    assert.equal(await usePalette("historyEnabled").getAttribute("aria-checked"), "false");
    checks.push(
      "Shared/device files remain independent; real restart retains the selected scope, data and display setting",
    );

    await host.main.bringToFront();
    await field("snippetRows").focus();
    await host.main.evaluate(() =>
      window.dock.executeCommand("at365.palette.snippets.open"),
    );
    panel = await host.page(popupPath);
    await panel
      .locator('.choices [data-index="0"] strong')
      .filter({ hasText: "このPC" })
      .waitFor();
    await host.main.evaluate(() => window.dock.toggleExtension('at365.palette', false));
    await until(
      () => panel.isClosed(),
      "stopping owner closes palette",
    );
    await until(
      async () =>
        (await snapshot()).extensions.find((e) => e.id === "at365.palette")
          .state === "stopped",
      "Applet stopped",
    );
    checks.push(
      "Stopping Palette closes its active nonactivating palette and releases native capture",
    );
    success = true;
  } finally {
    if (host) {
      if (!success) {
        await host.main
          .screenshot({ path: path.join(profile, "failure.png") })
          .catch(() => {});
        fs.writeFileSync(
          path.join(profile, "failure-state.json"),
          JSON.stringify(await snapshot().catch(() => ({})), null, 2),
        );
      }
      await host.close();
    }
    fs.writeFileSync(
      path.join(profile, "result.json"),
      JSON.stringify({ success, source, hash: host?.hash, checks }, null, 2),
    );
    console.log(JSON.stringify({ success, profile, checks }));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
