const { randomUUID } = require("node:crypto");

const fileName = "snippets.json";
function parseDocument(text) {
  if (text === null) return { schemaVersion: 1, items: [] };
  const document = JSON.parse(text.replace(/^\uFEFF/, ""));
  const ids = new Set();
  if (
    !document ||
    document.schemaVersion !== 1 ||
    !Array.isArray(document.items) ||
    Object.keys(document).some(
      (key) => !["schemaVersion", "items"].includes(key),
    )
  )
    throw Error("INVALID_DOCUMENT");
  for (const row of document.items) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some(
        (key) => !["id", "name", "text", "enabled"].includes(key),
      ) ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      typeof row.enabled !== "boolean"
    )
      throw Error("INVALID_DOCUMENT");
    ids.add(row.id);
  }
  return document;
}

function createPalette() {
  let context;
  let alive = false;
  let scopeEpoch = 0;
  let disposables = [];
  const t = (key, values) => context.localization.t(key, values);
  const revision = (snapshot) => snapshot.scope + ":" + snapshot.revision;
  const issue = (kind, key, field) => ({
    issue: { kind, message: t(key), ...(field ? { field } : {}) },
  });
  const read = async () => {
    const epoch = scopeEpoch;
    let snapshot;
    try {
      snapshot = await context.storage.files.readText(fileName, "configuration");
    } catch {
      throw Error(t("error.document"));
    }
    if (!alive || epoch !== scopeEpoch) throw Error(t("error.scopeChanged"));
    try {
      return { ...snapshot, document: parseDocument(snapshot.text), epoch };
    } catch {
      throw Error(t("error.document"));
    }
  };
  const action = (id, title, extra = {}) => ({ id, title: t(title), ...extra });
  const view = (snapshot) => ({
    revision: revision(snapshot),
    available: true,
    tabs: [
      {
        id: "snippets",
        toolbar: [action("refresh", "action.refresh")],
        panels: [
          {
            id: "snippets",
            title: t("snippets.title"),
            columns: [{ key: "name", title: t("field.name") }],
            list: {
              titleKey: "name",
              descriptionKey: "preview",
              enabledKey: "enabled",
            },
            rows: snapshot.document.items.map((row) => ({
              id: row.id,
              values: {
                name: row.name,
                preview: row.text.slice(0, 160).replace(/\r\n|\r|\n/g, " "),
                enabled: row.enabled,
              },
              actions: [
                action("edit", "action.edit", { role: "edit", rowId: row.id }),
                action("delete", "action.delete", {
                  role: "delete",
                  rowId: row.id,
                  confirm: t("confirm.delete", { name: row.name }),
                }),
                action("toggle", "action.toggle", {
                  role: "toggle",
                  rowId: row.id,
                }),
              ],
            })),
            actions: [
              action("add", "action.add", { role: "add" }),
              action("order", "action.order", { role: "order" }),
            ],
          },
        ],
      },
    ],
  });
  const dialog = (snapshot, row) => ({
    dialog: {
      title: t(row ? "dialog.edit" : "dialog.add"),
      revision: revision(snapshot),
      fields: [
        {
          key: "name",
          title: t("field.name"),
          type: "string",
          required: true,
          initialFocus: true,
        },
        {
          key: "text",
          title: t("field.text"),
          type: "string",
          presentation: "multiline",
          required: true,
        },
        { key: "enabled", title: t("field.enabled"), type: "boolean" },
      ],
      values: {
        name: row?.name ?? "",
        text: row?.text ?? "",
        enabled: row?.enabled ?? true,
      },
      submit: action("save", "action.save", row ? { rowId: row.id } : {}),
    },
  });
  const open = async (kind) => {
    let snapshot, emptyText;
    try {
      snapshot = await read();
    } catch (error) {
      if (kind !== "history") throw error;
      // A damaged snippet file must not prevent access to Windows clipboard history.
      snapshot = { document: { items: [] } };
      emptyText = t("error.document");
    }
    const integer = (key, fallback, minimum) => {
      const value = context.settings.get(key, fallback);
      return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
    };
    return context.inputPalette.open({
      kind,
      entries: snapshot.document.items
        .filter((row) => row.enabled)
        .map(({ id, name, text }) => ({ id, name, text })),
      titles: {
        snippets: t("palette.snippets"),
        history: t("palette.history"),
      },
      rows: {
        snippets: integer("snippetRows", 8, 1),
        history: integer("historyRows", 8, 1),
      },
      widths: {
        snippets: integer("snippetWidth", 370, 260),
        history: integer("historyWidth", 370, 260),
      },
      guide: context.settings.get("showGuide", true) === true,
      includeHistory: context.settings.get("includeHistory", true) === true,
      manageLabel: t("palette.manage"),
      ...(emptyText ? { emptyText } : {}),
    });
  };
  return {
    async activate(value) {
      context = value;
      alive = true;
      context.commands.register(
        "at365.palette.snippets.open",
        t("command.snippets"),
        () => open("snippets"),
      );
      context.commands.register(
        "at365.palette.history.open",
        t("command.history"),
        () => open("history"),
      );
      context.commands.register(
        "at365.palette.clipboard.settings",
        t("command.clipboardSettings"),
        () => context.inputPalette.openClipboardSettings(),
      );
      disposables = [
        context.storage.files.onScopeChanged(async () => {
          scopeEpoch++;
          await context.providers.changed();
        }),
        context.localization.onChanged(() => context.providers.changed()),
      ];
    },
    async deactivate() {
      alive = false;
      scopeEpoch++;
      for (const dispose of disposables.splice(0)) dispose();
    },
    async onProviderRequest(request, signal) {
      if (
        !alive ||
        signal.aborted ||
        request.actor?.kind !== "host" ||
        request.actor.external ||
        request.params?.providerId !== "snippets"
      )
        throw Error("PROVIDER_UNAVAILABLE");
      if (request.method === "prepare")
        return issue("validation", "error.settingsStorage");
      const snapshot = await read();
      const { params, method } = request;
      if (method === "snapshot") return view(snapshot);
      if (method === "refresh") return { value: null };
      if (params.expectedRevision !== revision(snapshot))
        return issue("conflict", "error.conflict");
      if (method === "add") return dialog(snapshot);
      const index = snapshot.document.items.findIndex(
        (row) => row.id === params.rowId,
      );
      if (method === "edit")
        return index < 0
          ? issue("conflict", "error.conflict")
          : dialog(snapshot, snapshot.document.items[index]);
      let items = structuredClone(snapshot.document.items);
      if (method === "save") {
        const values = params.values;
        if (!values || typeof values.name !== "string" || !values.name.trim())
          return issue("validation", "error.name", "name");
        if (typeof values.text !== "string" || !values.text.trim())
          return issue("validation", "error.text", "text");
        if (typeof values.enabled !== "boolean")
          return issue("validation", "error.document");
        if (params.rowId !== undefined && index < 0)
          return issue("conflict", "error.conflict");
        const row = {
          id: params.rowId ?? randomUUID(),
          name: values.name.trim(),
          text: values.text,
          enabled: values.enabled,
        };
        if (index < 0) items.push(row);
        else items[index] = row;
      } else if (method === "delete" || method === "toggle") {
        if (index < 0) return issue("conflict", "error.conflict");
        if (method === "delete") items.splice(index, 1);
        else items[index].enabled = !items[index].enabled;
      } else if (method === "order") {
        const ids = params.values?.ids;
        if (
          !Array.isArray(ids) ||
          ids.length !== items.length ||
          new Set(ids).size !== items.length
        )
          return issue("conflict", "error.conflict");
        const byId = new Map(items.map((row) => [row.id, row]));
        if (ids.some((id) => !byId.has(id)))
          return issue("conflict", "error.conflict");
        items = ids.map((id) => byId.get(id));
      } else throw Error("NOT_FOUND");
      await context.providers.authorize(request.authorization);
      if (!alive || signal.aborted || snapshot.epoch !== scopeEpoch)
        return issue("conflict", "error.scopeChanged");
      try {
        await context.storage.files.writeText(
          fileName,
          JSON.stringify({ schemaVersion: 1, items }, null, 2) + "\n",
          snapshot.revision,
          snapshot.scope,
        );
      } catch {
        try {
          if (revision(await read()) !== revision(snapshot))
            return issue("conflict", "error.conflict");
        } catch {
          /* The save failure remains actionable if the file cannot be reread. */
        }
        throw Error(t("error.save"));
      }
      await context.providers.changed();
      return { value: null };
    },
  };
}
module.exports = { createPalette, parseDocument };
