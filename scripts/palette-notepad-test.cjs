// Opt-in interactive checks. Native input is gated by the fixture window or isolated AppDock PID.
const fs = require("node:fs");
const path = require("node:path");
const hostRoot = path.resolve(
  process.env.APPDOCK_SOURCE_ROOT ||
    (process.argv[3] && !process.argv[3].startsWith("--")
      ? process.argv[3]
      : "../AppDock.at365"),
);
const fieldKey = (key) =>
  encodeURIComponent("applet:at365.palette") +
  "/" +
  encodeURIComponent("setting:" + key);
const { chromium } = require(
  path.join(hostRoot, "node_modules/playwright"),
);
const { readLogs } = require(path.join(hostRoot, "scripts/test-logs.cjs"));
const { randomUUID, createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const grabAltTap = process.argv.includes("--grab-alt-tap");
const altOnly = grabAltTap || process.argv.includes("--alt-only");
const published = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const root = path.resolve(__dirname, ".."),
  profile = path.join(
    root,
    ".artifacts",
    "input-palette-notepad-" + Date.now(),
  );
const token = "palette-" + randomUUID(),
  file = path.join(profile, token + ".txt");
const textDir = path.join(profile, "data/assets/texts");
fs.mkdirSync(textDir, { recursive: true });
fs.writeFileSync(path.join(textDir, "01.txt"), "こんにちは");
fs.writeFileSync(path.join(textDir, "02.txt"), "ありがとう🌸");
fs.writeFileSync(file, "\uFEFFあい");
const settings = require(
  path.join(hostRoot, "out/main/shared/settings-schema"),
).createDefaultSettings();
const values = ["こんにちは", "ありがとう🌸", "1行目\r\n2行目🌸"];
fs.writeFileSync(path.join(textDir, "03.txt"), values[2]);
for (const flag of ["off", "on"])
  fs.writeFileSync(path.join(textDir, flag + ".txt"), token + "-" + flag);
const snippetFiles = ["01.txt", "02.txt", "03.txt", "off.txt", "on.txt"];
for (let i = 6; i <= 10; i++) {
  const name = i + ".txt";
  fs.writeFileSync(path.join(textDir, name), "候補" + i);
  snippetFiles.push(name);
}
settings.updates.checkHostOnStartup = false;
settings.updates.checkAppletsOnStartup = false;
settings.host.closeToTray = false;
Object.assign(settings.updates, {
  checkHostOnStartup: false,
  checkAppletsOnStartup: false,
  checkHostOnAboutOpen: false,
});
settings.extensions["at365.palette"] = require("./fixture.cjs").install(
  profile,
  snippetFiles.map((file, i) => ({
    id: String(i),
    name: path.parse(file).name,
    text: fs.readFileSync(path.join(textDir, file), "utf8"),
    enabled: true,
  })),
);

settings.host.hardwareAcceleration = false;
settings.gestures.enabled = false;
settings.keybindings = [
  {
    id: "palette-notepad",
    command: "at365.palette.snippets.open",
    key: "Alt+C",
    enabled: true,
    when: { scope: "exe", appletIds: [], processes: ["notepad", "msedge"] },
    blockOriginalInput: true,
  },
];
if (grabAltTap) {
  settings.keybindings[0].when.processes = [
    "appdock.at365",
    "electron",
    "msedge",
  ];
} else if (altOnly) {
  settings.keybindings.push(
    {
      ...settings.keybindings[0],
      id: "history-notepad",
      key: "Alt+V",
      command: "at365.palette.history.open",
    },
    {
      ...settings.keybindings[0],
      id: "plain-after-alt",
      key: "F8",
      when: {
        scope: "exe",
        appletIds: [],
        processes: ["notepad", "msedge", "electron", "appdock.at365"],
      },
    },
    {
      ...settings.keybindings[0],
      id: "noop-editors",
      command: "appdock.noop",
      when: {
        scope: "exe",
        appletIds: [],
        processes: ["msedge", "electron", "appdock.at365"],
      },
    },
  );
  settings.keybindings[0].when = {
    scope: "exe",
    appletIds: [],
    processes: ["notepad"],
  };
}
fs.writeFileSync(
  require(path.join(hostRoot, "scripts/test-settings.cjs")).file(profile),
  JSON.stringify(settings),
);
let app, browser, child, helper, pending, host, context, mainEval, hash;
let grabHook, grabExit, grabReplays;
const checks = [];
let savedTestText,
  edge,
  notepadStarted = false;
const hashFile = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const wait = async (fn, name) => {
  const until = Date.now() + 18000;
  let last;
  do {
    const value = await fn().catch((e) => {
      last = e.message;
      return false;
    });
    if (value) return value;
    await new Promise((r) => setTimeout(r, 60));
  } while (Date.now() < until);
  throw Error(name + (last ? " (" + last + ")" : ""));
};
async function start() {
  if (grabAltTap) {
    const project = path.join(hostRoot, "tests/InputTests");
    const build = spawnSync(
      "dotnet",
      ["build", path.join(project, "InputTests.csproj"), "-c", "Release"],
      { windowsHide: true },
    );
    if (build.error || build.status !== 0)
      throw Error(
        "Grab fixture build failed: " + (build.error || build.stdout),
      );
    grabHook = spawn(
      path.join(project, "bin/Release/net10.0-windows/AppDock.InputTests.exe"),
      ["--palette-grab-hook"],
      { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] },
    );
    grabExit = once(grabHook, "close");
    const lines = createInterface({ input: grabHook.stdout });
    lines.on("line", (line) => {
      if (line.startsWith("replays=")) grabReplays = Number(line.slice(8));
    });
    const [ready] = await Promise.race([once(lines, "line"), grabExit]);
    assert.equal(ready, "ready", "grab hook installed before AppDock");
  }
  const build = spawnSync(
    "dotnet",
    [
      "build",
      path.join(hostRoot, "tests/fixtures/PaletteHistoryProbe/Probe.csproj"),
      "-c",
      "Release",
      "-o",
      path.join(root, ".artifacts/palette-probe"),
    ],
    { cwd: hostRoot, stdio: "pipe", windowsHide: true },
  );
  if (build.error || build.status !== 0)
    throw Error(
      "Could not build the synthetic clipboard fixture: " +
        (build.error?.message ?? build.stdout),
    );
  if (!published || !path.isAbsolute(published)) throw Error('Pass a sealed AppDock EXE');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const runtime = await require(path.join(hostRoot, 'scripts/page-test-host.cjs')).launch(
    profile, published, {}, path.join(root, '.artifacts'));
  app = runtime.app;
  host = runtime.main;
  context = app.context();
  mainEval = (fn, arg) => app.evaluate(fn, arg);
  hash = runtime.hash;
  const ps = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
    "Add-Type -Path $env:PALETTE_TEST_FIXTURE",
    "Add-Type -Path $env:PALETTE_TEST_CLIPBOARD",
    "$inputHostId=0",
    "while($null -ne ($action=[Console]::ReadLine())) { try { " +
      'if($action.StartsWith("clipboard-")){$ownerId=[PaletteTestClipboard]::OwnerPid();if($ownerId -and $ownerId -ne $inputHostId){$native=Get-CimInstance Win32_Process -Filter ("ProcessId="+$ownerId+" AND ParentProcessId="+$env:PALETTE_TEST_MAIN+" AND Name=\'AppDock.InputHost.exe\'");if($native){$inputHostId=$ownerId}};$result=[PaletteTestClipboard]::Check($inputHostId,$action.Substring(10))}else{$result=[PaletteNotepadFixture]::Run($env:PALETTE_TEST_TAB,$action)}' +
      "; [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{value=$result})) } catch { [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{error=$_.Exception.Message})) } }",
  ].join(";");
  helper = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-EncodedCommand",
      Buffer.from(ps, "utf16le").toString("base64"),
    ],
    {
      env: {
        ...env,
        PALETTE_TEST_TAB: token,
        PALETTE_TEST_GRAB: grabAltTap ? "1" : "0",
        PALETTE_TEST_FIXTURE: path.join(
          hostRoot,
          "tests/fixtures/InputPaletteNotepad.cs",
        ),
        PALETTE_TEST_CLIPBOARD: path.join(
          hostRoot,
          "tests/fixtures/PaletteTestClipboard.cs",
        ),
        PALETTE_TEST_MAIN: String(await mainEval(() => process.pid, null)),
        PALETTE_TEST_WINDOW: await mainEval(
          ({ BrowserWindow }, url) =>
            BrowserWindow.getAllWindows()
              .find((w) => w.webContents.getURL() === url)
              .getNativeWindowHandle()
              .readBigUInt64LE()
              .toString(),
          host.url(),
        ),
      },
      windowsHide: true,
      stdio: "pipe",
    },
  );
  helper.stderr.on("data", (d) =>
    fs.appendFileSync(path.join(profile, "helper.log"), d),
  );
  createInterface({ input: helper.stdout }).on("line", (line) => {
    if (!pending) return;
    const { resolve, reject } = pending;
    pending = null;
    try {
      const r = JSON.parse(line);
      if (r.error) throw Error(r.error);
      resolve(r.value);
    } catch (e) {
      reject(e);
    }
  });
  helper.on("exit", () => {
    pending?.reject(Error("Notepad helper closed"));
    pending = null;
  });
}
const requestFixture = (action) =>
  new Promise((resolve, reject) => {
    if (pending || helper.exitCode !== null)
      return reject(Error("helper unavailable"));
    pending = { resolve, reject };
    helper.stdin.write(action + "\n");
  });
let fixtureQueue = Promise.resolve();
const ask = (action) => {
  const work = fixtureQueue.then(() => requestFixture(action));
  fixtureQueue = work.catch(() => {});
  return work;
};
const act = async (a) => assert.equal(await ask(a), "ok", a);
const state = async (expected) =>
  wait(
    async () => (await ask("state")) === expected,
    "expected test document " + JSON.stringify(expected),
  );
const openKey = () => act("alt-c");
const paletteVisible = () =>
  mainEval(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) =>
          w.isVisible() &&
          w.webContents.getURL().endsWith("/input-palette.html"),
      ),
    null,
  );
const visible = async (history = false) => {
  const p = await wait(
    async () =>
      context
        .pages()
        .find((p) => !p.isClosed() && p.url().endsWith("/input-palette.html")),
    "palette from shortcut",
  );
  if (history)
    await p
      .locator("header strong")
      .filter({ hasText: "クリップボード履歴パレット" })
      .waitFor();
  else
    await p
      .locator('[data-index="0"] strong')
      .filter({ hasText: /^01$/ })
      .waitFor();
  await wait(paletteVisible, "visible palette");
  return p;
};
const open = async () => {
  await openKey();
  return visible();
};
const closed = () =>
  wait(async () => !(await paletteVisible()), "palette closes");
async function checkPaletteLabels(panel, title) {
  assert.equal(await panel.locator("header").innerText(), title);
  assert.equal(
    await panel.locator("footer span").first().textContent(),
    "↑↓ 選択　1–0 入力　←→ 切替　Enter 確定　Esc 閉じる",
  );
}
async function checkSnippetNavigation(panel) {
  await checkPaletteLabels(panel, "定型文パレット");
  for (const [action, expected] of [
    ["repeat-down", 4],
    ["repeat-down", 8],
    ["repeat-down", 9],
    ["repeat-down", 9],
    ["repeat-up", 5],
    ["repeat-up", 1],
    ["repeat-up", 0],
    ["repeat-up", 0],
  ]) {
    await act(action);
    const row = panel.locator(
      '[aria-current=true][data-index="' + expected + '"]',
    );
    await wait(
      async () =>
        row.evaluate(
          (el) => {
            const list = el.closest(".choices").getBoundingClientRect();
            const bounds = el.getBoundingClientRect();
            return (
              bounds.top >= list.top - 1 && bounds.bottom <= list.bottom + 1
            );
          },
          undefined,
          { timeout: 1000 },
        ),
      "entire selected row visible at index " + expected,
    );
  }
  await panel.screenshot({ path: path.join(profile, "snippets.png") });
  checks.push(
    "Held arrows move once per keydown, scroll each selection into view and stop at both ends",
  );
}
async function openEdgeField() {
  edge = await chromium.launch({
    channel: "msedge",
    headless: false,
    args: ["--no-first-run"],
  });
  const web = await edge.newPage();
  const html = path.join(profile, token + ".html");
  fs.writeFileSync(
    html,
    '<meta charset="utf-8"><title>' +
      token +
      '</title><textarea autofocus style="position:fixed;inset:0;width:100%;height:100%">あい</textarea>',
  );
  await web.goto(require("node:url").pathToFileURL(html).href);
  await web.bringToFront();
  await wait(
    async () => (await ask("edge-prepare")) === "ok",
    "activate isolated Edge test tab",
  );
  const field = web.locator("textarea");
  await field.focus();
  await field.evaluate((e) => e.setSelectionRange(1, 1));
  await wait(
    async () => (await ask("edge-guard")) === "ok",
    "foreground isolated Edge test tab",
  );
  return field;
}
async function checkNoopAlt(target, field) {
  await field.fill("");
  await field.focus();
  await wait(
    async () => (await ask(target + "-guard")) === "ok",
    "verified foreground " + target,
  );
  let expected = "";
  for (const release of [
    "release-test-alt",
    target + "-release-unobserved-alt",
    target + "-release-masked-alt",
  ]) {
    await act(target + "-alt-c-hold");
    await act(release);
    await act(target + "-plain-c");
    await act(target + "-plain-v");
    expected += "cv";
    await wait(
      async () => (await field.inputValue()) === expected,
      "plain C/V following noop in " + target + " with " + release,
    );
    await act(target + "-plain-f8");
    await visible();
    await act(target + "-esc");
    await closed();
  }
  checks.push(
    target +
      " Alt+C bound only to appdock.noop: plain C/V and unmodified F8 work after all three release paths",
  );
}
async function checkTapPalette(target, field) {
  for (const close of ["command", "escape"]) {
    await field.fill("");
    await field.focus();
    await act(target + "-guard");
    await act(target + "-alt-tap");
    // Alt can focus Edge's toolbar while CDP still reports a focused textarea.
    // Return native focus to the full-page editor without another keystroke.
    if (target === "edge") await act("edge-focus-field");
    await act(target + "-alt-c-hold");
    await visible();
    await act("release-test-alt");
    if (close === "escape") await act(target + "-esc");
    else
      await host.evaluate(() =>
        window.dock.executeCommand("at365.palette.snippets.open"),
      );
    await closed();
    await act(target + "-plain-c");
    await wait(
      async () =>
        (await field.inputValue()) === "c" || (await paletteVisible()),
      "plain C handled",
    );
    assert.equal(
      await paletteVisible(),
      false,
      target + ": plain C reopened the palette after " + close,
    );
    assert.equal(await field.inputValue(), "c");
    checks.push(
      target +
        ": standalone Alt, Alt+C, palette closed by " +
        close +
        ", plain C delivered",
    );
  }
}
(async () => {
  let success = false;
  let historyFixture,
    historyCommand,
    paintStarted = false;
  try {
    await start();
    host.setDefaultTimeout(12000);
    if (altOnly) {
      await host.evaluate(() =>
        window.dock.executeCommand("appdock.settings.applet.at365.palette.open"),
      );
      await require(
        path.join(hostRoot, "scripts/settings-host-helper.cjs"),
      ).settingsPage(host);
      await host.getByRole("button", { name: "動作設定", exact: true }).click();
      await wait(
        async () => (await ask("host-prepare")) === "ok",
        "activate isolated AppDock window",
      );
      const hostField = host.getByRole("combobox", {
        name: "設定を検索",
        exact: true,
      });
      if (grabAltTap) {
        await checkTapPalette("host", hostField);
        await checkTapPalette("edge", await openEdgeField());
        grabHook.stdin.end();
        assert.equal((await grabExit)[0], 0);
        assert.equal(
          grabReplays,
          8,
          "the competing hook replayed both Alt presses in every case",
        );
        success = true;
        console.log("Passed:", checks, profile);
        return;
      }
      await checkNoopAlt("host", hostField);
      await checkNoopAlt("edge", await openEdgeField());
      await edge.close();
      edge = undefined;
      spawn("notepad.exe", [file], { stdio: "ignore" }).unref();
      notepadStarted = true;
      await wait(
        async () =>
          ["ok", "clicked test editor"].includes(await ask("prepare")),
        "activate fixture Notepad",
      );
      await state("あい");
      await act("caret");
      let expected = "あ";
      for (let i = 0; i < 12; i++) {
        const history = i % 2 === 1;
        await act(history ? "alt-v-hold" : "alt-c-hold");
        const panel = await visible(history);
        const session = await panel
          .locator("header")
          .getAttribute("data-palette-session");
        await act(
          i < 4
            ? "release-test-alt"
            : i < 8
              ? "release-unobserved-alt"
              : "release-masked-alt",
        );
        if (i === 0) await checkSnippetNavigation(panel);
        if (i === 1)
          await checkPaletteLabels(panel, "クリップボード履歴パレット");
        await act("down");
        if ((await panel.locator('[data-index="1"]').count()) > 0)
          await panel
            .locator('[data-index="1"][aria-current=true]')
            .waitFor({ timeout: 1500 });
        await act("up");
        if ((await panel.locator('[data-index="0"]').count()) > 0)
          await panel
            .locator('[data-index="0"][aria-current=true]')
            .waitFor({ timeout: 1500 });
        assert.equal(
          await panel
            .locator("header")
            .getAttribute("data-palette-session", { timeout: 1500 }),
          session,
        );
        await act("esc");
        await closed();
        for (const key of ["c", "v"]) {
          await act("plain-" + key);
          expected += key;
          await state(expected + "い");
        }
        await act("plain-f8");
        await visible();
        await act("esc");
        await closed();
      }
      await act("alt-c-hold");
      await visible();
      await act("plain-v");
      await visible(true); // Alt is still physically held by the fixture.
      await act("release-test-alt");
      await act("esc");
      await closed();
      checks.push(
        "12 Alt+C/V cycles (normal, unobserved release, and modifier/menu mask plus unobserved release): arrows, plain C/V and unmodified F8 without Alt+Tab; held Alt+C then V switches to history",
      );
      success = true;
      console.log("Passed:", checks, profile);
      return;
    }
    await host.evaluate(() =>
      window.dock.executeCommand("appdock.settings.applet.at365.palette.open"),
    );
    await require(
      path.join(hostRoot, "scripts/settings-host-helper.cjs"),
    ).settingsPage(host);
    await host.getByRole("button", { name: "動作設定", exact: true }).click();
    const toggle = host.getByRole("switch", {
      name: "貼り付けた定型文をクリップボード履歴へ追加する",
      exact: true,
    });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await toggle.click();
    await require(
      path.join(hostRoot, "scripts/settings-immediate-helper.cjs"),
    ).settleSettings(host);
    assert.equal(
      await host.evaluate(
        async () =>
          (await window.dock.snapshot()).settings.value.extensions[
            "at365.palette"
          ].settings.includeHistory,
      ),
      false,
    );
    checks.push(
      "History enabled by default; main settings switch saves OFF immediately",
    );
    assert.equal(
      await ask("clipboard-check"),
      "empty",
      "Personal clipboard preserved; desktop test requires an initially empty clipboard",
    );
    spawn("notepad.exe", [file], { stdio: "ignore" }).unref();
    notepadStarted = true;
    await wait(
      async () => ["ok", "clicked test editor"].includes(await ask("prepare")),
      "activate fixture Notepad",
    );
    await state("あい");
    await act("caret");
    let panel = await open();
    await checkSnippetNavigation(panel);
    await act("down");
    await panel.locator('[data-index="1"][aria-current=true]').waitFor();
    await state("あい");
    await act("esc");
    await closed();
    await state("あい");
    checks.push("Escape leaves original text and caret");
    panel = await open();
    await act("down");
    await panel.locator('[data-index="1"][aria-current=true]').waitFor();
    await act("repeat-enter");
    await closed();
    await state("あありがとう🌸い");
    checks.push(
      "Held Enter inserts the second row exactly once at the original caret, including surrogate pair",
    );
    panel = await open();
    const bounds = await panel.locator('[data-index="0"]').boundingBox();
    const hit = await mainEval(({ BrowserWindow, screen }, point) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("/input-palette.html"),
      );
      const b = win.getContentBounds(),
        p = screen.dipToScreenPoint({
          x: b.x + Math.round(point.x + Math.min(24, point.width / 2)),
          y: b.y + Math.round(point.y + point.height / 2),
        });
      return [
        p.x,
        p.y,
        win.getNativeWindowHandle().readBigUInt64LE().toString(),
      ];
    }, bounds);
    await wait(async () => {
      const hitState = await ask("click " + hit.join(" "));
      if (hitState !== "ok")
        throw Error(hitState + " row=" + JSON.stringify(bounds));
      return true;
    }, "native palette hit target");
    await closed();
    let body = values[1] + values[0];
    await state("あ" + body + "い");
    checks.push("real mouse click chose a row while Notepad retained focus");
    const normalized = (s) => s.replace(/\r\n?/g, "\n");
    for (let i = 0; i < 30; i++) {
      assert.equal(
        await ask("clipboard-check"),
        "excluded",
        "History and cloud disabled on selected test document",
      );
      const row = i % values.length;
      const panel = await open();
      for (let n = 0; n < row; n++) await act("down");
      await panel
        .locator('[data-index="' + row + '"][aria-current=true]')
        .waitFor();
      await act("enter");
      await closed();
      body += values[row];
    }
    let previousSession = "";
    for (let i = 0; i < 10; i++) {
      assert.equal(await ask("clipboard-check"), "excluded");
      const panel = await open();
      const session = await wait(async () => {
        const id = await panel
          .locator("header")
          .getAttribute("data-palette-session", { timeout: 1500 });
        return id && id !== previousSession ? id : false;
      }, "next distinct palette session");
      previousSession = session;
      await act("enter");
      body += values[0];
    }
    await closed();
    savedTestText = "あ" + body + "い";
    await act("save");
    await wait(
      async () =>
        normalized(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) ===
        normalized(savedTestText),
      "Notepad file contents including all 42 pastes",
    );
    checks.push(
      "42 real pastes in order: 32 varied rows, then 10 Alt+C / Enter cycles without waiting for dismissal; saved file matches",
    );
    await open();
    const hostPoint = await mainEval(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) =>
          w.webContents.getURL().includes("index.html") &&
          !w.webContents.getURL().includes("/command-palette/"),
      );
      w.showInactive();
      w.setAlwaysOnTop(true, "pop-up-menu");
      const b = w.getBounds(),
        point = screen.dipToScreenPoint({ x: b.x + 90, y: b.y + 14 });
      return [
        point.x,
        point.y,
        w.getNativeWindowHandle().readBigUInt64LE().toString(),
      ];
    }, null);
    await wait(
      async () => (await ask("click " + hostPoint.join(" "))) === "ok",
      "native host hit target",
    );
    await wait(
      async () => (await ask("state")) === "inactive",
      "verified foreground change",
    );
    await closed();
    checks.push("changing foreground cancels without insertion");
    await mainEval(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows().filter((w) =>
        w.webContents.getURL().includes("index.html"),
      )) {
        win.setAlwaysOnTop(false);
        win.hide();
      }
    }, null);
    const field = await openEdgeField();
    assert.equal(await ask("clipboard-check"), "excluded");
    await act("edge-open");
    await visible();
    await act("edge-enter");
    await closed();
    await wait(
      async () => (await field.inputValue()) === "あこんにちはい",
      "Edge received actual Ctrl+V",
    );
    assert.equal(await ask("edge-guard"), "ok");
    assert.equal(await ask("clipboard-check"), "excluded");
    checks.push(
      "isolated Edge textarea: Ctrl+V inserts Japanese at middle caret with the browser still foreground",
    );
    await edge.close();
    edge = undefined;
    assert.equal(await ask("clipboard-clear"), "cleared");
    historyFixture = spawn(
      path.join(root, ".artifacts/palette-probe/Probe.exe"),
      [token, profile],
      { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] },
    );
    const lines = createInterface({ input: historyFixture.stdout });
    historyCommand = async (action) => {
      const answer = once(lines, "line", {
        signal: AbortSignal.timeout(20000),
      });
      historyFixture.stdin.write(action + "\n");
      return (await answer)[0];
    };
    assert.equal(await historyCommand("watch-options"), "ok");
    for (const flag of ["off", "on"]) {
      if (flag === "on") {
        await host.evaluate(() =>
          window.dock.executeCommand(
            "appdock.settings.applet.at365.palette.open",
          ),
        );
        await host.getByRole("button", { name: "動作設定", exact: true }).click();
        await toggle.click();
        await require(
          path.join(hostRoot, "scripts/settings-immediate-helper.cjs"),
        ).settleSettings(host);
        assert.equal(await toggle.getAttribute("aria-checked"), "true");
      }
      await wait(
        async () =>
          ["ok", "clicked test editor"].includes(await ask("prepare")),
        "fixture Notepad foreground",
      );
      const optionsPanel = await open();
      await optionsPanel
        .getByRole("button", { name: new RegExp("^" + flag) })
        .evaluate((el) => el.click());
      await closed();
      assert.equal(
        await ask("clipboard-check"),
        flag === "on" ? "included" : "excluded",
      );
    }
    const until = Date.now() + 8000;
    let checked;
    do {
      checked = await historyCommand("check-options");
      if (checked === "pending") await new Promise((r) => setTimeout(r, 50));
    } while (checked === "pending" && Date.now() < until);
    assert.equal(checked, "ok");
    assert(["cleared", "empty"].includes(await ask("clipboard-clear")));
    checks.push(
      "Real Windows history contains the unique ON snippet and excludes the OFF snippet; test item removed",
    );
    assert.equal(await historyCommand("seed"), "ok");
    await wait(
      async () => ["ok", "clicked test editor"].includes(await ask("prepare")),
      "fixture Notepad foreground",
    );
    await act("caret");
    const openHistory = async () => {
      await host.evaluate(() =>
        window.dock.executeCommand("at365.palette.history.open"),
      );
      return visible(true);
    };
    const history = await openHistory();
    await checkPaletteLabels(history, "クリップボード履歴パレット");
    const afterRepeat = Math.min(
      4,
      (await history.locator("[data-index]").count()) - 1,
    );
    assert(afterRepeat >= 1, "both seeded history items are available");
    await act("repeat-down");
    await history
      .locator('[data-index="' + afterRepeat + '"][aria-current=true]')
      .waitFor();
    await act("repeat-up");
    await history.locator('[data-index="0"][aria-current=true]').waitFor();
    const textRow = history.getByRole("button", {
      name: token + "🌸",
      exact: true,
    });
    await textRow.waitFor();
    await act("guard");
    await textRow.evaluate((el) => el.click());
    await closed();
    await act("save");
    await wait(
      async () => fs.readFileSync(file, "utf8").includes("あ" + token + "🌸"),
      "actual history text in saved Notepad file",
    );
    assert.equal(await historyCommand("track"), "ok");
    checks.push(
      "OS history text with unique ID pasted into saved Notepad file at the original caret",
    );
    spawn("mspaint.exe", [path.join(profile, token + ".bmp")], {
      stdio: "ignore",
    }).unref();
    paintStarted = true;
    await wait(
      async () => (await ask("paint-prepare")) === "ok",
      "fixture Paint foreground",
    );
    const images = await openHistory();
    const findImageRow = () =>
      wait(async () => {
        const index = await images
          .locator("button")
          .evaluateAll(async (buttons, hex) => {
            for (const [i, b] of buttons.entries()) {
              const img = b.querySelector("img");
              if (!img) continue;
              await img.decode();
              if (img.naturalWidth !== 16 || img.naturalHeight !== 16) continue;
              const canvas = document.createElement("canvas");
              canvas.width = 16;
              canvas.height = 16;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0);
              const [r, g, blue] = ctx.getImageData(8, 8, 1, 1).data;
              if (((r << 16) | (g << 8) | blue) === parseInt(hex, 16)) return i;
            }
            return -1;
          }, token.slice(-6));
        return index >= 0 ? images.locator("button").nth(index) : null;
      }, "unique synthetic bitmap preview");
    const imageRow = await findImageRow();
    await act("paint-guard");
    await imageRow.evaluate((el) => el.click());
    await closed();
    assert.equal(await historyCommand("track"), "ok");
    await act("paint-commit");
    let nextSave = 0;
    await wait(async () => {
      // Paint can finish decoding after accepting Ctrl+V. Only save the named fixture again.
      if (Date.now() >= nextSave) {
        await act("paint-save");
        nextSave = Date.now() + 500;
      }
      return (await historyCommand("check-paint")) === "ok";
    }, "256 exact pixels in the saved Paint bitmap");
    checks.push(
      "OS history thumbnail and original 16x16 bitmap matched by pixel color; all 256 pixels in saved Paint file",
    );
    await openHistory();
    const stale = await findImageRow();
    const previous = await images
      .locator("header")
      .getAttribute("data-palette-session");
    assert.equal(await historyCommand("remove-image"), "ok");
    await stale.evaluate((el) => el.click());
    await wait(async () => {
      const current = await images
        .locator("header")
        .getAttribute("data-palette-session", { timeout: 1500 });
      return current && current !== previous;
    }, "deleted item refreshes the displayed history");
    await act("paint-guard");
    await act("paint-esc");
    await closed();
    checks.push(
      "Selecting the deleted image refreshes the list with Paint still foreground",
    );
    assert.equal(await historyCommand("finish"), "cleaned");
    historyFixture = undefined;
    assert.equal(
      readLogs(profile).filter(
        (e) => e.source === "at365.palette" && e.level === "error",
      ).length,
      0,
      "No palette errors",
    );
    success = true;
    console.log("Passed:", checks, profile);
  } finally {
    if (altOnly && helper?.exitCode === null)
      await ask("release-test-alt").catch(() => {});
    if (historyFixture?.exitCode === null)
      await historyCommand("finish").catch(() => {});
    if (paintStarted && (await ask("paint-prepare").catch(() => "")) === "ok")
      await act("paint-close").catch(() => {});
    if (edge) await edge.close().catch(() => {});
    if (!altOnly && helper?.exitCode === null) {
      const result = await ask("clipboard-clear").catch(() => "unavailable");
      checks.push("Test clipboard cleanup: " + result);
      if (success) assert.equal(result, "empty");
    }
    if (notepadStarted && helper?.exitCode === null) {
      await wait(
        async () =>
          ["ok", "clicked test editor"].includes(await ask("prepare")),
        "restore own test tab",
      ).catch(() => {});
      if ((await ask("guard").catch(() => null)) === "ok") {
        await act("save").catch(() => {});
        await act("close").catch(() => {});
      }
    }
    if (host)
      await host
        .evaluate(() => window.dock.executeCommand("appdock.quit"))
        .catch(() => {});
    if (app) await app.close();
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
    if (helper?.exitCode === null) {
      helper.stdin.end();
    }
    if (grabHook?.exitCode === null) {
      grabHook.stdin.end();
      await grabExit;
    }
    fs.writeFileSync(
      path.join(profile, "result.json"),
      JSON.stringify({ success, checks, hash }, null, 2),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
