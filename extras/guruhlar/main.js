"use strict";

const $ = (id) => document.getElementById(id);
const MAX_ITEMS = 48;
let group = { name: "Yangi guruh", items: [] };
let editing = false;
let saveTimer = 0;
let noticeTimer = 0;
let dragIndex = null;
const details = new Map();

function notify(message) {
  $("status").textContent = message;
  $("status").classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("status").classList.remove("show"), 3000);
}

function save() {
  clearTimeout(saveTimer);
  widget.storage.set("group", group).catch((error) => {
    widget.log(`guruhlar: ${error.message}`);
    notify("Saqlab bo‘lmadi. Qayta urinib ko‘ring.");
  });
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

function nameOf(item) {
  return item.label || details.get(item.path)?.name || item.path.split(/[\\/]/).filter(Boolean).pop() || item.path;
}

async function loadDetails(path) {
  if (details.has(path)) return;
  try { details.set(path, await widget.shell.info(path, { size: 96 })); }
  catch (error) {
    details.set(path, { exists: false, kind: "missing" });
    widget.log(`guruhlar: ${error.message}`);
  }
  render();
}

function render() {
  $("title").textContent = group.name || "Yangi guruh";
  $("count").textContent = `${group.items.length} ta element`;
  $("edit").textContent = editing ? "✓" : "✎";
  $("edit").title = editing ? "Tayyor" : "Guruhni sozlash";
  $("edit").setAttribute("aria-label", $("edit").title);
  $("editor").hidden = !editing;
  $("items").hidden = group.items.length === 0;
  $("empty").hidden = group.items.length > 0;
  if (document.activeElement !== $("name")) $("name").value = group.name;

  const fragment = document.createDocumentFragment();
  group.items.forEach((item, index) => {
    const tile = document.createElement("div");
    tile.className = "item" + (details.get(item.path)?.exists === false ? " missing" : "");
    tile.tabIndex = editing ? -1 : 0;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", nameOf(item));
    tile.title = item.path;
    tile.dataset.index = String(index);
    tile.draggable = editing;
    if (editing) tile.setAttribute("data-no-drag", "");

    const icon = details.get(item.path)?.icon;
    if (icon) {
      const image = document.createElement("img");
      image.src = icon;
      image.alt = "";
      image.draggable = false;
      tile.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "fallback";
      fallback.textContent = details.get(item.path)?.exists === false ? "!" : "▣";
      tile.append(fallback);
    }

    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 40;
      input.value = nameOf(item);
      input.title = "Yorliq nomi";
      input.setAttribute("aria-label", "Yorliq nomi");
      input.setAttribute("data-no-drag", "");
      input.addEventListener("change", () => {
        item.label = input.value.trim().slice(0, 40);
        save();
        render();
      });
      tile.append(input);

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Guruhdan olib tashlash";
      remove.setAttribute("aria-label", `${nameOf(item)} ni olib tashlash`);
      remove.setAttribute("data-no-drag", "");
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        group.items.splice(index, 1);
        save();
        render();
      });
      tile.append(remove);
    } else {
      const label = document.createElement("span");
      label.className = "item-name";
      label.textContent = nameOf(item);
      tile.append(label);
      tile.addEventListener("click", () => open(item.path));
      tile.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(item.path);
        }
      });
    }
    fragment.append(tile);
  });
  $("items").replaceChildren(fragment);
}

async function open(path) {
  try { await widget.shell.launch(path); }
  catch (error) {
    widget.log(`guruhlar: ${error.message}`);
    notify("Bu papka yoki faylni ochib bo‘lmadi.");
    details.delete(path);
    await loadDetails(path);
  }
}

async function addPaths(paths) {
  let count = 0;
  for (const raw of paths) {
    const path = String(raw || "").trim();
    if (!path || group.items.some((item) => item.path.toLowerCase() === path.toLowerCase())) continue;
    if (group.items.length >= MAX_ITEMS) { notify("Bir guruhga ko‘pi bilan 48 ta element qo‘shiladi."); break; }
    group.items.push({ path, label: "" });
    count++;
    loadDetails(path);
  }
  if (count) { save(); render(); notify(`${count} ta element qo‘shildi`); }
}

$("edit").addEventListener("click", () => {
  editing = !editing;
  render();
  if (editing) $("name").focus();
});

$("name").addEventListener("input", () => {
  group.name = $("name").value.slice(0, 40);
  $("title").textContent = group.name || "Yangi guruh";
  saveSoon();
});
$("name").addEventListener("change", () => {
  group.name = $("name").value.trim().slice(0, 40) || "Yangi guruh";
  save();
  render();
});

$("add-folder").addEventListener("click", async () => {
  const path = await widget.shell.pick({ type: "folder", title: "Guruhga papka tanlang" }).catch((e) => { notify(e.message); return null; });
  if (path) addPaths([path]);
});
$("add-file").addEventListener("click", async () => {
  const path = await widget.shell.pick({ type: "file", filter: "all", title: "Guruhga fayl yoki yorliq tanlang" }).catch((e) => { notify(e.message); return null; });
  if (path) addPaths([path]);
});

$("items").addEventListener("dragstart", (event) => {
  if (!editing) return;
  const tile = event.target.closest(".item");
  if (!tile || event.target.closest("input,button")) return;
  dragIndex = Number(tile.dataset.index);
  event.dataTransfer.setData("application/x-vidjetuz-group-item", String(dragIndex));
  event.dataTransfer.effectAllowed = "move";
});
$("items").addEventListener("dragend", () => { dragIndex = null; });

document.addEventListener("dragover", (event) => {
  if (dragIndex !== null || [...event.dataTransfer.types].includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = dragIndex !== null ? "move" : "copy";
  }
});
document.addEventListener("dragenter", (event) => {
  if (dragIndex === null && [...event.dataTransfer.types].includes("Files")) document.body.classList.add("dropping");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("dropping");
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("dropping");
  if (dragIndex !== null) {
    const target = event.target.closest(".item");
    if (target) {
      const to = Number(target.dataset.index);
      if (to !== dragIndex) {
        const [item] = group.items.splice(dragIndex, 1);
        group.items.splice(to, 0, item);
        save();
        render();
      }
    }
    dragIndex = null;
    return;
  }
  if (event.dataTransfer.files.length) {
    const paths = await widget.shell.paths(event.dataTransfer.files).catch((e) => { notify(e.message); return []; });
    addPaths(paths);
  }
});

widget.storage.get("group").then((saved) => {
  if (saved && typeof saved === "object") {
    group.name = typeof saved.name === "string" ? saved.name.slice(0, 40) : "Yangi guruh";
    group.items = Array.isArray(saved.items) ? saved.items.filter((item) => item && typeof item.path === "string" && item.path.length > 0)
      .slice(0, MAX_ITEMS).map((item) => ({ path: item.path, label: typeof item.label === "string" ? item.label.slice(0, 40) : "" })) : [];
  }
  render();
  for (const item of group.items) loadDetails(item.path);
}).catch((error) => { widget.log(`guruhlar: ${error.message}`); render(); notify("Guruh ma’lumotlarini o‘qib bo‘lmadi."); });

render();
