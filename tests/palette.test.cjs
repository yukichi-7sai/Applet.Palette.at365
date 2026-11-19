const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createPalette, parseDocument } = require("../palette.cjs");
const messages = require("../resources/translations/applet.json");
const manifest = require("../extension.json");

async function fixture(t) {
  let scope = "shared",
    scopeChanged,
    changed = 0;
  const files = new Map(),
    commands = new Map(),
    opens = [];
  const digest = (text) =>
    text === null ? "missing" : createHash("sha256").update(text).digest("hex");
  const read = (selected) => {
    const resolved = selected === "configuration" ? scope : selected;
    const text = files.get(resolved) ?? null;
    return { scope: resolved, text, revision: digest(text) };
  };
  const settings = {};
  let saveError,
    authorize = async () => ({ kind: "host" });
  const applet = createPalette();
  await applet.activate({
    localization: {
      t: (key, values = {}) =>
        (messages[key] ?? key).replace(/{{(\w+)}}/g, (_, name) => values[name]),
      onChanged: () => () => {},
    },
    settings: {
      get: (key, fallback) => settings[key] ?? fallback,
      set: () => assert.fail("Snippet data must never enter Settings"),
    },
    storage: {
      files: {
        readText: async (name, selected) => {
          assert.equal(name, "snippets.json");
          return read(selected);
        },
        writeText: async (name, text, expected, selected) => {
          assert.equal(name, "snippets.json");
          if (saveError) throw saveError;
          assert.equal(expected, read(selected).revision);
          files.set(selected, text);
          return { revision: digest(text), scope: selected };
        },
        onScopeChanged: (callback) => {
          scopeChanged = callback;
          return () => {
            scopeChanged = undefined;
          };
        },
      },
    },
    providers: {
      changed: async () => changed++,
      authorize: (...args) => authorize(...args),
    },
    commands: { register: (id, title, run) => commands.set(id, run) },
    inputPalette: {
      openPopup: async (request) => {
        opens.push(request);
        return { accepted: true };
      },
      openClipboardSettings: async () => ({ accepted: true }),
    },
  });
  t.after(() => applet.deactivate());
  const request = (
    method,
    params = {},
    signal = new AbortController().signal,
  ) =>
    applet.onProviderRequest(
      {
        method,
        params: { providerId: "snippets", ...params },
        authorization: "host-issued",
        actor: { kind: "host", external: false },
      },
      signal,
    );
  const snapshot = () => request("snapshot");
  const add = async (name, text) => {
    const view = await snapshot();
    return request("save", {
      expectedRevision: view.revision,
      values: { name, text, enabled: true },
    });
  };
  return {
    files,
    settings,
    applet,
    request,
    snapshot,
    add,
    commands,
    opens,
    setSaveError: (value) => {
      saveError = value;
    },
    setAuthorize: (value) => {
      authorize = value;
    },
    switchScope: async (value) => {
      scope = value;
      await scopeChanged(value);
    },
    changes: () => changed,
  };
}

test("inline registration, edit, toggle, order and delete persist exact bodies only in file Storage", async (t) => {
  const f = await fixture(t);
  const empty = await f.snapshot();
  const before = await f.request("add", { expectedRevision: empty.revision });
  assert.equal(before.dialog.values.text, "");
  assert.equal(
    f.files.size,
    0,
    "opening or cancelling a dialog does not create a file",
  );
  const body = "1行目\r\n2行目😀\n{{literal}} $t(literal)";
  await f.add("名前", body);
  await f.add("二番目", "second");
  let view = await f.snapshot();
  const [first, second] = view.tabs[0].panels[0].rows;
  const editor = await f.request("edit", {
    rowId: first.id,
    expectedRevision: view.revision,
  });
  assert.equal(editor.dialog.values.text, body);
  await f.request("save", {
    rowId: first.id,
    expectedRevision: view.revision,
    values: { ...editor.dialog.values, name: "変更" },
  });
  view = await f.snapshot();
  await f.request("order", {
    expectedRevision: view.revision,
    values: { ids: [second.id, first.id] },
  });
  view = await f.snapshot();
  await f.request("toggle", {
    rowId: first.id,
    expectedRevision: view.revision,
  });
  await f.commands.get("at365.palette.snippets.open")();
  assert.deepEqual(
    f.opens.at(-1).views.find((view) => view.id === "snippets").entries.map((row) => row.id),
    [second.id],
  );
  assert.deepEqual(f.settings, {});
  const stored = parseDocument(f.files.get("shared"));
  assert.equal(stored.items[1].text, body);
  assert.equal(stored.items[1].id, first.id);
  view = await f.snapshot();
  await f.request("delete", {
    rowId: second.id,
    expectedRevision: view.revision,
  });
  assert.equal(parseDocument(f.files.get("shared")).items.length, 1);
});

test("stale edits, removed rows and invalid permutations preserve the newest file", async (t) => {
  const f = await fixture(t);
  await f.add("original", "first");
  const old = await f.snapshot();
  await f.add("newer", "second");
  const latest = f.files.get("shared");
  const result = await f.request("save", {
    expectedRevision: old.revision,
    values: { name: "stale", text: "lost", enabled: true },
  });
  assert.equal(result.issue.kind, "conflict");
  const now = await f.snapshot();
  const ids = now.tabs[0].panels[0].rows.map((row) => row.id);
  for (const order of [[], [ids[0], ids[0]], [ids[0], "missing"]])
    assert.equal(
      (
        await f.request("order", {
          expectedRevision: now.revision,
          values: { ids: order },
        })
      ).issue.kind,
      "conflict",
    );
  assert.equal(
    (
      await f.request("delete", {
        expectedRevision: now.revision,
        rowId: "missing",
      })
    ).issue.kind,
    "conflict",
  );
  assert.equal(f.files.get("shared"), latest);
});

test("storage scope switching never copies data and rejects a dialog from another scope", async (t) => {
  const f = await fixture(t);
  await f.add("shared", "shared body");
  const shared = await f.snapshot();
  await f.switchScope("device");
  assert.equal((await f.snapshot()).tabs[0].panels[0].rows.length, 0);
  assert.equal(
    (
      await f.request("save", {
        expectedRevision: shared.revision,
        values: { name: "stale", text: "stale", enabled: true },
      })
    ).issue.kind,
    "conflict",
  );
  assert(!f.files.has("device"));
  await f.add("local", "device body");
  await f.switchScope("shared");
  assert.equal(
    (await f.snapshot()).tabs[0].panels[0].rows[0].values.name,
    "shared",
  );
  assert.equal(
    parseDocument(f.files.get("device")).items[0].text,
    "device body",
  );
});

test("validation, failed writes, revoked requests and malformed files preserve data", async (t) => {
  const f = await fixture(t);
  for (const values of [
    { name: "", text: "x", enabled: true },
    { name: "x", text: " ", enabled: true },
  ])
    assert.equal(
      (
        await f.request("save", {
          expectedRevision: (await f.snapshot()).revision,
          values,
        })
      ).issue.kind,
      "validation",
    );
  f.setSaveError(Error("EACCES"));
  await assert.rejects(() => f.add("cannot write", "body"), /保存できません/);
  assert.equal(f.files.size, 0);
  f.setSaveError(undefined);
  const controller = new AbortController();
  f.setAuthorize(async () => controller.abort());
  const reply = await f.request(
    "save",
    {
      expectedRevision: (await f.snapshot()).revision,
      values: { name: "cancelled", text: "body", enabled: true },
    },
    controller.signal,
  );
  assert.equal(reply.issue.kind, "conflict");
  assert.equal(f.files.size, 0);
  f.files.set("shared", "{broken");
  await assert.rejects(() => f.snapshot(), /ファイルを読み込めません/);
  assert.equal(f.files.get("shared"), "{broken");
  await f.commands.get("at365.palette.history.open")();
  assert.equal(f.opens.at(-1).initialView, "history");
  const snippets = f.opens.at(-1).views.find((view) => view.id === "snippets");
  assert.deepEqual(snippets.entries, []);
  assert.match(snippets.emptyText, /ファイルを読み込めません/);
});

test("large documents and candidate sets survive without truncation or a registration limit", async (t) => {
  const f = await fixture(t);
  const text = "本文😀\r\n".repeat(40000);
  const items = Array.from({ length: 300 }, (_, i) => ({
    id: String(i),
    name: `Item ${i}`,
    text: i ? "text" : text,
    enabled: true,
  }));
  f.files.set("shared", JSON.stringify({ schemaVersion: 1, items }));
  await f.commands.get("at365.palette.snippets.open")();
  assert.equal(f.opens[0].views[0].entries.length, 300);
  assert.equal(f.opens[0].views[0].entries[0].text, text);
  assert.equal((await f.snapshot()).tabs[0].panels[0].rows.length, 300);
});

test("large reorder preserves every registration without expanding the list into function arguments", async (t) => {
  const f = await fixture(t);
  const items = Array.from({ length: 100000 }, (_, i) => ({
    id: String(i), name: String(i), text: 'body', enabled: true,
  }));
  const text = JSON.stringify({ schemaVersion: 1, items });
  f.files.set('shared', text);
  const expectedRevision = 'shared:' + createHash('sha256').update(text).digest('hex');
  const ids = items.map((row) => row.id).reverse();
  await f.request('order', { expectedRevision, values: { ids } });
  assert.deepEqual(parseDocument(f.files.get('shared')).items.map((row) => row.id), ids);
});

test("new commands use independent display settings and never expose snippet data through Settings", async (t) => {
  const f = await fixture(t);
  Object.assign(f.settings, {
    snippetRows: 4,
    historyRows: 3,
    snippetWidth: 480,
    historyWidth: 420,
    showGuide: false,
    includeHistory: false,
  });
  await f.commands.get("at365.palette.history.open")();
  assert.equal(f.opens[0].ui, "ui/input-palette.html");
  assert.deepEqual(f.opens[0].views.map(({id, rows, width}) => [id, rows, width]), [
    ["snippets", 4, 480],
    ["history", 3, 420],
  ]);
  assert.equal(f.opens[0].labels.keys, undefined);
  assert.equal(f.opens[0].includeHistory, false);
  assert.equal(
    (await f.request("prepare", { value: ["body"] })).issue.kind,
    "validation",
  );
  assert(
    manifest.commands.every(
      (command) => !command.automation && !command.aliases,
    ),
  );
});

test("disabled palettes stay closed through either command and are omitted from switching", async (t) => {
  const f = await fixture(t);
  const openSnippets = f.commands.get("at365.palette.snippets.open");
  const openHistory = f.commands.get("at365.palette.history.open");
  await openSnippets();
  assert.deepEqual(f.opens.at(-1).views.map(({id}) => id), ["snippets", "history"]);
  assert.match(f.opens.at(-1).labels.keys, /←→/);

  f.settings.historyEnabled = false;
  await openHistory();
  assert.equal(f.opens.length, 1);
  await openSnippets();
  assert.deepEqual(f.opens.at(-1).views.map(({id}) => id), ["snippets"]);
  assert.doesNotMatch(f.opens.at(-1).labels.keys, /←→/);
  assert.equal(f.opens.at(-1).includeHistory, true);

  f.settings.snippetsEnabled = false;
  await openSnippets();
  await openHistory();
  assert.equal(f.opens.length, 2);

  f.files.set("shared", "{broken");
  f.settings.historyEnabled = true;
  await openHistory();
  assert.deepEqual(f.opens.at(-1).views.map(({id}) => id), ["history"]);
  assert.doesNotMatch(f.opens.at(-1).labels.keys, /←→/);
  assert.equal(f.files.get("shared"), "{broken");
});
