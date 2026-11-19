"use strict";

const $ = (id) => document.getElementById(id);
const MAX_GROUPS = 24;
const MAX_ITEMS = 48;
const info = new Map();
let data = { groups: [newGroup()] };
let editing = false;
let armedDelete = null;
let dragging = null;
let saveTimer = 0;
let noticeTimer = 0;

function newGroup() {
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`, name: "Yangi guruh", collapsed: false, items: [] };
}

function notify(message) {
  $("status").textContent = message;
  $("status").classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("status").classList.remove("show"), 3000);
}

function save() {
  clearTimeout(saveTimer);
  widget.storage.set("group", data).catch((error) => {
    widget.log(`guruhlar: ${error.message}`);
    notify("Saqlab bo‘lmadi. Qayta urinib ko‘ring.");
  });
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

function findGroup(id) { return data.groups.find((group) => group.id === id); }
function labelOf(item) { return item.label || info.get(item.path)?.name || item.path.split(/[\\/]/).filter(Boolean).pop() || item.path; }

async function loadInfo(path) {
  if (info.has(path)) return;
  try { info.set(path, await widget.shell.info(path, { size: 96 })); }
  catch (error) {
    info.set(path, { exists: false, kind: "missing" });
    widget.log(`guruhlar: ${error.message}`);
  }
  render();
}

function button(text, className, action, title = text) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = text;
  el.title = title;
  el.setAttribute("data-no-drag", "");
  el.addEventListener("click", action);
  return el;
}

function renderItem(group, item, index) {
  const tile = document.createElement("div");
  tile.className = "item" + (info.get(item.path)?.exists === false ? " missing" : "");
  tile.dataset.index = String(index);
  tile.dataset.groupId = group.id;
  tile.title = item.path;
  tile.tabIndex = editing ? -1 : 0;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", labelOf(item));
  tile.draggable = editing;
  if (editing) tile.setAttribute("data-no-drag", "");

  const icon = info.get(item.path)?.icon;
  if (icon) {
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    image.draggable = false;
    tile.append(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "fallback";
    fallback.textContent = info.get(item.path)?.exists === false ? "!" : "▣";
    tile.append(fallback);
  }

  if (editing) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.value = labelOf(item);
    input.title = "Yorliq nomi";
    input.setAttribute("aria-label", "Yorliq nomi");
    input.setAttribute("data-no-drag", "");
    input.addEventListener("change", () => {
      item.label = input.value.trim().slice(0, 40);
      save();
      render();
    });
    tile.append(input);
    tile.append(button("×", "remove", (event) => {
      event.stopPropagation();
      group.items.splice(index, 1);
      save();
      render();
    }, `${labelOf(item)} ni guruhdan olib tashlash`));
  } else {
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = labelOf(item);
    tile.append(name);
    tile.addEventListener("click", () => open(item.path));
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(item.path);
      }
    });
  }
  return tile;
}

function renderGroup(group) {
  const section = document.createElement("section");
  section.className = "group" + (group.collapsed ? " collapsed" : "");
  section.dataset.groupId = group.id;

  const head = button("", "group-head", () => {
    group.collapsed = !group.collapsed;
    armedDelete = null;
    save();
    render();
  }, group.collapsed ? "Guruhni ochish" : "Guruhni yig‘ish");
  head.setAttribute("aria-expanded", String(!group.collapsed));
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = group.collapsed ? "▸" : "▾";
  const title = document.createElement("span");
  title.className = "group-title";
  title.textContent = group.name || "Yangi guruh";
  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `${group.items.length} ta`;
  head.append(chevron, title, count);
  section.append(head);
  if (group.collapsed) return section;

  const content = document.createElement("div");
  content.className = "group-content";
  if (editing) {
    const editor = document.createElement("div");
    editor.className = "group-editor";
    editor.setAttribute("data-no-drag", "");
    const label = document.createElement("label");
    label.textContent = "Guruh nomi";
    const input = document.createElement("input");
    input.className = "group-name-input";
    input.type = "text";
    input.maxLength = 40;
    input.value = group.name;
    input.placeholder = "Masalan: Ish loyihalari";
    input.setAttribute("aria-label", "Guruh nomi");
    input.setAttribute("data-no-drag", "");
    input.addEventListener("input", () => {
      group.name = input.value.slice(0, 40);
      title.textContent = group.name || "Yangi guruh";
      saveSoon();
    });
    input.addEventListener("change", () => {
      group.name = input.value.trim().slice(0, 40) || "Yangi guruh";
      save();
      render();
    });
    label.append(input);
    editor.append(label);

    const actions = document.createElement("div");
    actions.className = "group-actions";
    actions.append(button("+ Papka", "", () => pickInto(group.id, "folder")));
    actions.append(button("+ Fayl", "", () => pickInto(group.id, "file"), "Fayl yoki yorliq qo‘shish"));
    const remove = button(armedDelete === group.id ? "Tasdiqlash" : "Guruhni o‘chirish",
      "delete" + (armedDelete === group.id ? " armed" : ""), () => {
        if (armedDelete !== group.id) { armedDelete = group.id; render(); return; }
        data.groups = data.groups.filter((item) => item.id !== group.id);
        armedDelete = null;
        save();
        render();
      }, "Guruhni ro‘yxatdan olib tashlash; papkalarning o‘zi o‘chmaydi");
    actions.append(remove);
    editor.append(actions);
    content.append(editor);
  }

  const items = document.createElement("div");
  items.className = "items";
  for (let index = 0; index < group.items.length; index++) items.append(renderItem(group, group.items[index], index));
  content.append(items);
  if (!group.items.length) {
    const empty = document.createElement("div");
    empty.className = "group-empty";
    empty.textContent = editing ? "Bu guruh bo‘sh. Papka qo‘shing yoki shu yerga sudrang." : "Bu guruhda hali papka yo‘q.";
    content.append(empty);
  }
  section.append(content);
  return section;
}

function render() {
  const total = data.groups.reduce((sum, group) => sum + group.items.length, 0);
  $("summary").textContent = `${data.groups.length} ta guruh · ${total} ta element`;
  $("edit").textContent = editing ? "✓" : "✎";
  $("edit").title = editing ? "Tayyor" : "Guruhlarni sozlash";
  $("edit").setAttribute("aria-label", $("edit").title);
  $("toolbar").hidden = !editing;
  $("no-groups").hidden = data.groups.length !== 0;
  const container = $("groups");
  const scroll = container.scrollTop;
  container.replaceChildren(...data.groups.map(renderGroup));
  container.scrollTop = scroll;
}

async function open(path) {
  try { await widget.shell.launch(path); }
  catch (error) {
    widget.log(`guruhlar: ${error.message}`);
    notify("Bu papka yoki faylni ochib bo‘lmadi.");
    info.delete(path);
    await loadInfo(path);
  }
}

async function pickInto(groupId, type) {
  const options = type === "folder"
    ? { type: "folder", title: "Guruhga papka tanlang" }
    : { type: "file", filter: "all", title: "Guruhga fayl yoki yorliq tanlang" };
  const path = await widget.shell.pick(options).catch((error) => { notify(error.message); return null; });
  if (path) addPaths(groupId, [path]);
}

function addPaths(groupId, paths) {
  const group = findGroup(groupId);
  if (!group) return;
  let added = 0;
  for (const raw of paths) {
    const path = String(raw || "").trim();
    if (!path || group.items.some((item) => item.path.toLowerCase() === path.toLowerCase())) continue;
    if (group.items.length >= MAX_ITEMS) { notify("Bir guruhga ko‘pi bilan 48 ta element qo‘shiladi."); break; }
    group.items.push({ path, label: "" });
    added++;
    loadInfo(path);
  }
  if (added) {
    group.collapsed = false;
    save();
    render();
    notify(`${added} ta element qo‘shildi`);
  }
}

$("edit").addEventListener("click", () => {
  editing = !editing;
  armedDelete = null;
  render();
});

$("add-group").addEventListener("click", () => {
  if (data.groups.length >= MAX_GROUPS) { notify("Ko‘pi bilan 24 ta guruh yaratish mumkin."); return; }
  const group = newGroup();
  data.groups.push(group);
  save();
  render();
  $("groups").scrollTop = $("groups").scrollHeight;
  $("groups").querySelector(`[data-group-id="${group.id}"] .group-name-input`)?.focus();
});

$("groups").addEventListener("dragstart", (event) => {
  if (!editing || event.target.closest("input,button")) return;
  const tile = event.target.closest(".item");
  if (!tile) return;
  dragging = { groupId: tile.dataset.groupId, index: Number(tile.dataset.index) };
  event.dataTransfer.setData("application/x-vidjetuz-group-item", "1");
  event.dataTransfer.effectAllowed = "move";
});
$("groups").addEventListener("dragend", () => { dragging = null; });

document.addEventListener("dragover", (event) => {
  if (dragging || [...event.dataTransfer.types].includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = dragging ? "move" : "copy";
  }
});
document.addEventListener("dragenter", (event) => {
  if (!dragging && [...event.dataTransfer.types].includes("Files")) document.body.classList.add("dropping");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("dropping");
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("dropping");
  const targetSection = event.target.closest(".group");
  const targetGroup = findGroup(targetSection?.dataset.groupId) || data.groups[0];
  if (dragging) {
    const source = findGroup(dragging.groupId);
    if (source && targetGroup && source.items[dragging.index]) {
      const tile = event.target.closest(".item");
      let to = tile ? Number(tile.dataset.index) : targetGroup.items.length;
      const [item] = source.items.splice(dragging.index, 1);
      if (source === targetGroup && to > dragging.index) to--;
      targetGroup.items.splice(to, 0, item);
      targetGroup.collapsed = false;
      save();
      render();
    }
    dragging = null;
    return;
  }
  if (event.dataTransfer.files.length) {
    if (!targetGroup) { notify("Avval yangi guruh yarating."); return; }
    const paths = await widget.shell.paths(event.dataTransfer.files).catch((error) => { notify(error.message); return []; });
    addPaths(targetGroup.id, paths);
  }
});

function normalizeGroup(raw) {
  const group = newGroup();
  group.id = typeof raw.id === "string" && raw.id ? raw.id : group.id;
  group.name = typeof raw.name === "string" ? raw.name.trim().slice(0, 40) || "Yangi guruh" : group.name;
  group.collapsed = raw.collapsed === true;
  group.items = Array.isArray(raw.items) ? raw.items.filter((item) => item && typeof item.path === "string" && item.path.trim())
    .slice(0, MAX_ITEMS).map((item) => ({ path: item.path, label: typeof item.label === "string" ? item.label.slice(0, 40) : "" })) : [];
  return group;
}

widget.storage.get("group").then((saved) => {
  if (saved && typeof saved === "object" && Array.isArray(saved.groups)) {
    data.groups = saved.groups.slice(0, MAX_GROUPS).filter((raw) => raw && typeof raw === "object").map(normalizeGroup);
  } else if (saved && typeof saved === "object") {
    // Version 1 stored one group directly. Keep its name and items when upgrading.
    data.groups = [normalizeGroup(saved)];
    save();
  }
  render();
  for (const group of data.groups) for (const item of group.items) loadInfo(item.path);
}).catch((error) => {
  widget.log(`guruhlar: ${error.message}`);
  notify("Guruh ma’lumotlarini o‘qib bo‘lmadi.");
});

render();
