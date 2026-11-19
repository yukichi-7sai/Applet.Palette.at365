const popup = window.inputPalette;
const root = document.getElementById("root");
const header = root.querySelector("header");
const title = document.getElementById("title");
const manage = root.querySelector(".manage");
const list = root.querySelector(".choices");
const empty = document.getElementById("empty");
const rows = document.getElementById("rows");
const footer = root.querySelector("footer");
const grip = root.querySelector(".resize-handle");
const rowHeight = 50;

let model;
let selected = 0;
let renderedStart = -1;
let renderedEnd = -1;
let drag;

function current(session, view) {
  return model?.session === session && model.view === view;
}

function setLabel(button, value) {
  button.title = value;
  button.setAttribute("aria-label", value);
}

function rowButton(row, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.index = String(index);
  button.style.top = `${index * rowHeight}px`;
  button.style.height = `${rowHeight}px`;
  button.setAttribute("aria-current", String(selected === index));
  if (row.title) button.title = row.title;
  if (row.thumbnail) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = row.thumbnail;
    button.append(image);
  }
  const name = document.createElement("strong");
  name.textContent = row.name;
  const preview = document.createElement("span");
  preview.textContent = row.preview;
  button.append(name, preview);
  if (index < 10) {
    const digit = document.createElement("kbd");
    digit.setAttribute("aria-hidden", "true");
    digit.textContent = String((index + 1) % 10);
    button.append(digit);
  }
  return button;
}

function drawRows() {
  if (!model?.rows.length) return;
  const start = Math.max(0, Math.floor(list.scrollTop / rowHeight) - 1);
  const end = Math.min(
    model.rows.length,
    start + Math.ceil(list.clientHeight / rowHeight) + 2,
  );
  if (start === renderedStart && end === renderedEnd) return;
  renderedStart = start;
  renderedEnd = end;
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index++) {
    fragment.append(rowButton(model.rows[index], index));
  }
  rows.replaceChildren(fragment);
}

function reveal(index) {
  const y = index * rowHeight;
  if (y < list.scrollTop) list.scrollTop = y;
  else if (y + rowHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = y + rowHeight - list.clientHeight;
  }
}

function finishResize() {
  const pointer = drag;
  drag = undefined;
  if (!pointer) return;
  popup.resize(pointer.session, pointer.view, "end", pointer.x, pointer.y);
  if (grip.hasPointerCapture(pointer.id))
    grip.releasePointerCapture(pointer.id);
}

list.addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) event.preventDefault();
});
list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (model && button)
    popup.choose(model.session, model.view, Number(button.dataset.index));
});
list.addEventListener("scroll", () => {
  if (!model) return;
  drawRows();
  popup.scroll(model.session, model.view, list.scrollTop);
});
manage.addEventListener("mousedown", (event) => event.preventDefault());
manage.addEventListener("click", () => {
  if (model) popup.manage(model.session, model.view);
});

grip.addEventListener("pointerdown", (event) => {
  if (!model || event.button !== 0) return;
  event.preventDefault();
  grip.setPointerCapture(event.pointerId);
  drag = {
    id: event.pointerId,
    session: model.session,
    view: model.view,
    x: event.clientX,
    y: event.clientY,
  };
  popup.resize(drag.session, drag.view, "start", drag.x, drag.y);
});
grip.addEventListener("pointermove", (event) => {
  if (drag?.id !== event.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  popup.resize(drag.session, drag.view, "move", drag.x, drag.y);
});
grip.addEventListener("pointerup", (event) => {
  if (drag?.id !== event.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  finishResize();
});
grip.addEventListener("pointercancel", finishResize);
grip.addEventListener("lostpointercapture", finishResize);
new ResizeObserver(() => drawRows()).observe(list);

popup.captureView((session, view) => {
  if (current(session, view)) popup.viewState(session, view, list.scrollTop);
});
popup.selected((session, view, index) => {
  if (!current(session, view)) return;
  rows
    .querySelector('[aria-current="true"]')
    ?.setAttribute("aria-current", "false");
  selected = index;
  reveal(index);
  drawRows();
  rows
    .querySelector(`[data-index="${index}"]`)
    ?.setAttribute("aria-current", "true");
});
popup.navigate((session, view, direction) => {
  if (!current(session, view)) return;
  const index = model.views.indexOf(model.kind);
  const step = direction === "left" ? -1 : 1;
  return model.views[(index + step + model.views.length) % model.views.length];
});
popup.models((next) => {
  finishResize();
  model = next;
  root.hidden = !model;
  if (!model) {
    rows.replaceChildren();
    return;
  }
  selected = model.selected;
  renderedStart = renderedEnd = -1;
  header.dataset.paletteSession = model.session;
  title.textContent = model.title;
  setLabel(manage, model.manage);
  manage.hidden = !model.manage;
  setLabel(grip, model.labels.resize);
  const hints = [model.labels.keys, model.labels.keyHelp]
    .filter(Boolean)
    .map((label) => {
      const line = document.createElement("span");
      line.textContent = line.title = label;
      return line;
    });
  footer.replaceChildren(...hints, grip);
  footer.classList.toggle("compact", hints.length === 0);
  empty.hidden = model.rows.length > 0;
  empty.textContent = model.empty;
  rows.hidden = model.rows.length === 0;
  rows.style.height = `${model.rows.length * rowHeight}px`;
  rows.replaceChildren();
  list.scrollTop = model.scrollTop;
  if (!model.restoreScroll && model.rows.length) reveal(selected);
  drawRows();
  popup.ready(model.session, model.view);
});
