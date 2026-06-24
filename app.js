import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COL = "nodes";

let lang = "ru";
let tree = [];
let seeding = false;
let loaded = false;   // true, когда данные пришли из Firestore
let frontId = null;   // верхний раздел, стоящий «впереди» на сцене со сферой
let cmtOpenId = null; // у какой задачи открыта панель комментариев
const ICONS = ["ti-settings", "ti-building-bank", "ti-trending-up", "ti-box", "ti-star"];

const T = {
  ru: { started: "выполнено", back: "Назад", empty: "Пунктов пока нет — добавьте через админку", finish: "ФИНИШ",
        details: "Смотреть детальнее", sectionProgress: "общий прогресс<br>раздела",
        comments: "Комментарии", commentPh: "Написать комментарий…", send: "Отправить", noComments: "Комментариев пока нет", delComment: "Удалить комментарий?" },
  en: { started: "done", back: "Back", empty: "No items yet — add them via admin", finish: "FINISH",
        details: "View details", sectionProgress: "section<br>progress",
        comments: "Comments", commentPh: "Write a comment…", send: "Send", noComments: "No comments yet", delComment: "Delete comment?" }
};

// Стартовая структура. Заливается ОДИН раз, если база пустая.
// Дальше всё управляется через salary-admin.
const SEED = [
  { id: "s1", parentId: null, order: 0, title_ru: "Технические доработки", title_en: "Technical improvements" },
  { id: "ss1", parentId: "s1", order: 0, title_ru: "Marketing Research", title_en: "Marketing Research" },
  { id: "ss2", parentId: "s1", order: 1, title_ru: "ESS", title_en: "ESS" },
  { id: "i1", parentId: "ss2", order: 0, title_ru: "Тест", title_en: "Test" },
  { id: "i2", parentId: "ss2", order: 1, title_ru: "Тест 1", title_en: "Test 1" },
  { id: "i3", parentId: "ss2", order: 2, title_ru: "Тест 2", title_en: "Test 2" },
  { id: "ss3", parentId: "s1", order: 2, title_ru: "ИБ", title_en: "Information security" },
  { id: "ss4", parentId: "s1", order: 3, title_ru: "O!Business", title_en: "O!Business" },
  { id: "ss5", parentId: "s1", order: 4, title_ru: "Мой О!", title_en: "My O!" },
  { id: "s2", parentId: null, order: 1, title_ru: "Операционный блок", title_en: "Operational block" },
  { id: "ss6", parentId: "s2", order: 0, title_ru: "Схема работы", title_en: "Workflow scheme" },
  { id: "i4", parentId: "ss6", order: 0, title_ru: "Временная схема", title_en: "Temporary scheme" },
  { id: "i5", parentId: "ss6", order: 1, title_ru: "Целевая", title_en: "Target scheme" },
  { id: "ss7", parentId: "s2", order: 1, title_ru: "Ревизия действующих ЗПП", title_en: "Review of current payroll" },
  { id: "ss8", parentId: "s2", order: 2, title_ru: "Тарифы", title_en: "Tariffs" },
  { id: "ss9", parentId: "s2", order: 3, title_ru: "ТЗ/Отчетность", title_en: "Specs / reporting" },
  { id: "ss10", parentId: "s2", order: 4, title_ru: "Зачисление ЗП", title_en: "Salary crediting" },
  { id: "s3", parentId: null, order: 2, title_ru: "Продажи", title_en: "Sales" },
  { id: "ss11", parentId: "s3", order: 0, title_ru: "Коммерческое предложение", title_en: "Commercial offer" },
  { id: "i6", parentId: "ss11", order: 0, title_ru: "Saima offer", title_en: "Saima offer" },
  { id: "i7", parentId: "ss11", order: 1, title_ru: "NUR offer", title_en: "NUR offer" }
];

const CACHE_KEY = "roadmap_nodes_v1";

// приоритет задачи: highest / high / medium / low (пусто = не задан)
const PRIO_LABEL = { highest: "Highest", high: "High", medium: "Medium", low: "Low" };

// ---------- навигация через hash ----------
// Текущая страница хранится в адресной строке (#/<id>), а не в памяти.
// Благодаря этому: F5 не сбрасывает на главную, а кнопка/жест «назад» работают.
function currentView() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  return id ? { t: "node", id } : { t: "home" };
}
function go(id) { location.hash = id ? "#/" + encodeURIComponent(id) : "#/"; }
window.addEventListener("hashchange", render);

start();

function initialPaint() {
  // Мгновенный показ: сначала кэш браузера, иначе стартовая структура.
  // Реальные данные подтянутся из базы в фоне и обновят экран.
  let flat = null;
  try { const c = localStorage.getItem(CACHE_KEY); if (c) flat = JSON.parse(c); } catch (e) {}
  if (!flat || !flat.length) flat = SEED.map((n) => ({ ...n, done: false }));
  tree = buildTree(flat);
  render();
}

function start() {
  initialPaint();
  onSnapshot(collection(db, COL), (snap) => {
    const flat = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (flat.length === 0) { seed(); return; }
    loaded = true;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(flat)); } catch (e) {}
    tree = buildTree(flat);
    render();
  }, (err) => {
    // Если база недоступна (например, истекли правила Firestore) — не зависаем
    // на «Загрузка…», а показываем кэш/структуру либо кидаем на главную.
    console.error("Firestore:", err.message);
    loaded = true;
    render();
  });
  // Страховка: если база молчит дольше 6 сек — перестаём ждать.
  setTimeout(() => { if (!loaded) { loaded = true; render(); } }, 6000);
}

async function seed() {
  if (seeding) return;
  seeding = true;
  const batch = writeBatch(db);
  SEED.forEach((n) => {
    batch.set(doc(db, COL, n.id), {
      parentId: n.parentId,
      order: n.order,
      title_ru: n.title_ru,
      title_en: n.title_en,
      done: false
    });
  });
  await batch.commit();   // onSnapshot сработает заново и отрисует
  seeding = false;
}

// ---------- модель ----------
function buildTree(items) {
  const byId = {};
  items.forEach((i) => (byId[i.id] = { ...i, children: [] }));
  const roots = [];
  items.forEach((i) => {
    const node = byId[i.id];
    if (i.parentId && byId[i.parentId]) byId[i.parentId].children.push(node);
    else roots.push(node);
  });
  const sortRec = (arr) => {
    arr.sort((a, b) => (a.order || 0) - (b.order || 0));
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}
function isLeaf(n) { return !n.children || n.children.length === 0; }
function totalLeaves(n) { return isLeaf(n) ? 1 : n.children.reduce((a, c) => a + totalLeaves(c), 0); }
function doneLeaves(n) { return isLeaf(n) ? (n.done ? 1 : 0) : n.children.reduce((a, c) => a + doneLeaves(c), 0); }
function pct(n) { return Math.round((doneLeaves(n) / Math.max(totalLeaves(n), 1)) * 100); }
function title(n) { return n["title_" + lang] || n.title_ru || ""; }
function descOf(n) { return n["description_" + lang] || n.description_ru || n.description || ""; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function prioBadge(n) {
  return PRIO_LABEL[n.priority] ? `<span class="prio prio-${n.priority}">${PRIO_LABEL[n.priority]}</span>` : "";
}
function attachChips(n) {
  let s = "";
  if (n.link_url) s += `<a class="chip" href="${encodeURI(n.link_url)}" target="_blank" rel="noopener"><i class="ti ti-link"></i>${esc(n.link_title || n.link_url)}</a>`;
  if (n.file_url) s += `<a class="chip" href="${encodeURI(n.file_url)}" target="_blank" rel="noopener"><i class="ti ti-download"></i>${esc(n.file_title || "Файл")}</a>`;
  return s ? `<div class="attach-row">${s}</div>` : "";
}

function findNode(id, nodes = tree) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) { const r = findNode(id, n.children); if (r) return r; }
  }
  return null;
}
function wrap2(str) {
  if (str.length <= 13) return [str];
  const w = str.split(" ");
  if (w.length === 1) return [str];
  let best = 0, bd = 1e9, full = str.length, acc = "";
  for (let i = 0; i < w.length - 1; i++) {
    acc += (i ? " " : "") + w[i];
    const d = Math.abs(acc.length - (full - acc.length));
    if (d < bd) { bd = d; best = i; }
  }
  return [w.slice(0, best + 1).join(" "), w.slice(best + 1).join(" ")];
}

// ---------- главный экран: сфера + разделы вокруг ----------
function home() {
  const roots = tree;
  if (!roots.length) {
    document.getElementById("stage").innerHTML = `<div class="empty">${T[lang].empty}</div>`;
    setLeft("");
    return;
  }
  // все три раздела развёрнуты: [0] слева, [1] справа, [2] снизу по центру
  const SLOTS = [
    { x: 250,  y: 150 },
    { x: 1230, y: 150 },
    { x: 740,  y: 545 }
  ];
  const W = 420;
  const iconOf = {};
  roots.forEach((r, i) => (iconOf[r.id] = ICONS[i % ICONS.length]));
  const ov = pct({ children: roots });

  const cards = roots.slice(0, 3).map((sec, i) => {
    const pos = SLOTS[i] || SLOTS[2], p = pct(sec), ic = iconOf[sec.id];
    const style = `left:${pos.x}px;top:${pos.y}px;width:${W}px;transform:translate(-50%,0)`;
    const subs = (sec.children || []).map((c) => {
      const cp = pct(c), col = cp >= 100 ? "var(--success)" : (cp > 0 ? "var(--pink)" : "rgba(255,255,255,.25)");
      return `<div class="subrow">` +
        `<span class="dot" style="background:${col}"></span>` +
        `<span class="t">${esc(title(c))}</span>` +
        `<span class="b"><span style="width:${cp}%;background:${cp >= 100 ? "var(--success)" : "var(--pink)"}"></span></span>` +
        `<span class="p">${cp}%</span></div>`;
    }).join("");
    return `<div class="card front" style="${style}">` +
      `<div class="card-head"><i class="ic ti ${ic}"></i>` +
      `<button class="detail-btn" data-open="${sec.id}">${T[lang].details} <i class="ti ti-arrow-right"></i></button></div>` +
      `<div class="nm">${esc(title(sec))}</div>` +
      `<div class="ovbox"><div class="big">${p}%</div><div class="lab">${T[lang].sectionProgress}</div></div>` +
      (subs || `<div class="empty">${T[lang].empty}</div>`) +
      `</div>`;
  }).join("");

  const links =
    `<line x1="740" y1="300" x2="300" y2="200"/><circle cx="520" cy="250" r="2.5"/>` +
    `<line x1="740" y1="300" x2="1180" y2="200"/><circle cx="960" cy="250" r="2.5"/>` +
    `<line x1="740" y1="300" x2="740" y2="545"/><circle cx="740" cy="422" r="2.5"/>`;

  setLeft(`<span class="overall">${ov}% ${T[lang].started}</span>`);
  document.getElementById("stage").innerHTML =
    `<div class="sphere-stage">` +
      `<div class="stage-title">Salary Project Roadmap</div>` +
      `<svg class="links" viewBox="0 0 1480 860" preserveAspectRatio="none">` +
        `<g stroke="#E8005A" stroke-width="1.4" opacity=".5" fill="#ff4d92">${links}</g></svg>` +
      `<div class="orb-wrap">` +
        `<div class="halo"></div>` +
        `<div class="glow"></div>` +
        `<div class="orbit"><div class="ring"></div></div>` +
        `<div class="orbit b"><div class="ring"></div></div>` +
        `<svg class="globe" viewBox="0 0 120 120" role="img" aria-label="O!Bank">` +
          `<defs><radialGradient id="core" cx="48%" cy="44%" r="74%">` +
            `<stop offset="0%" stop-color="#ffd0e2"/><stop offset="24%" stop-color="#ff7ab0"/>` +
            `<stop offset="58%" stop-color="#E8005A"/><stop offset="100%" stop-color="#37001a"/></radialGradient></defs>` +
          `<circle cx="60" cy="60" r="47" fill="url(#core)"/>` +
          `<circle cx="60" cy="60" r="47" fill="none" stroke="#ff8fbb" stroke-width="1" opacity=".85"/>` +
          `<ellipse cx="60" cy="60" rx="47" ry="15" fill="none" stroke="#ffe1ec" stroke-width=".6" opacity=".4"/>` +
          `<ellipse cx="60" cy="60" rx="47" ry="32" fill="none" stroke="#ffe1ec" stroke-width=".6" opacity=".3"/>` +
          `<ellipse cx="60" cy="60" rx="47" ry="47" fill="none" stroke="#fff0f6" stroke-width=".6" opacity=".5"/>` +
          `<ellipse cx="60" cy="60" rx="29" ry="47" fill="none" stroke="#fff0f6" stroke-width=".6" opacity=".4"/>` +
          `<ellipse cx="60" cy="60" rx="12" ry="47" fill="none" stroke="#fff0f6" stroke-width=".6" opacity=".3"/>` +
        `</svg>` +
        `<div class="backlight"></div><div class="orb-label">O!Bank</div>` +
      `</div>` +
      cards +
    `</div>`;
}

// ---------- страница раздела/подраздела ----------
function page(node) {
  const p = pct(node);
  let h = `<div class="page-head"><span class="page-title">${esc(title(node))}</span>` +
    `<span class="bar" style="max-width:160px"><span style="width:${p}%"></span></span>` +
    `<span class="pct">${p}%</span></div>`;

  const ch = node.children || [];
  if (!ch.length) {
    h += `<div class="empty">${T[lang].empty}</div>`;
  }
  ch.forEach((c) => {
    if (isLeaf(c)) {
      const g = !!c.done;
      const cn = (c.comments || []).length;
      h += `<div class="row task${g ? " done" : ""}">` +
        `<input type="checkbox" data-id="${c.id}" ${g ? "checked" : ""}>` +
        `<span class="name">${esc(title(c))}</span>` +
        `<div class="desc"><span class="desc-txt">${esc(descOf(c))}</span>${attachChips(c)}</div>` +
        prioBadge(c) +
        `<button class="cmt-btn" data-cmt="${c.id}" title="${T[lang].comments}"><i class="ti ti-message-2"></i><span>${cn}</span></button>` +
        (g ? `<i class="ti ti-circle-check" style="color:var(--success)"></i>` : "") +
        `</div>`;
    } else {
      const cp = pct(c);
      h += `<div class="row" data-open="${c.id}">` +
        `<i class="ti ti-folder" style="color:var(--pink)"></i>` +
        `<span class="name">${esc(title(c))}</span>` +
        `<span class="bar"><span style="width:${cp}%"></span></span>` +
        `<span class="pct">${cp}%</span>` +
        `<i class="ti ti-chevron-right" style="color:var(--muted)"></i></div>`;
    }
  });

  setLeft(`<button class="back" data-back="1"><i class="ti ti-arrow-left"></i>${T[lang].back}</button>`);
  document.getElementById("stage").innerHTML = h;
}

function setLeft(html) { document.getElementById("leftslot").innerHTML = html; }

function render() {
  if (!tree.length) {
    document.getElementById("stage").innerHTML = '<div class="loading">Загрузка…</div>';
    setLeft("");
  } else {
    const view = currentView();
    if (view.t === "home") home();
    else {
      const node = findNode(view.id);
      // Узел не найден — сразу показываем главную, не зависаем; появится из базы — render() откроет.
      if (node) page(node); else home();
    }
  }
  if (cmtOpenId) { ensureDrawer(); fillDrawer(); }   // живое обновление открытой панели комментариев
}

// ---------- комментарии (пишутся прямо в роадмэпе, без входа) ----------
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString(lang === "ru" ? "ru-RU" : "en-US",
      { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
function ensureDrawer() {
  if (document.getElementById("cmtDrawer")) return;
  const d = document.createElement("div");
  d.id = "cmtDrawer"; d.className = "cmt-drawer";
  d.innerHTML =
    `<div class="cmt-head"><span class="cmt-title" id="cmtTitle"></span>` +
    `<button class="cmt-x" id="cmtClose" aria-label="close">✕</button></div>` +
    `<div class="cmt-list" id="cmtList"></div>` +
    `<div class="cmt-add"><textarea id="cmtText" placeholder="${T[lang].commentPh}"></textarea>` +
    `<button class="cmt-send" id="cmtSend">${T[lang].send}</button></div>`;
  document.body.appendChild(d);
  document.getElementById("cmtClose").addEventListener("click", closeComments);
  document.getElementById("cmtSend").addEventListener("click", sendComment);
  document.getElementById("cmtText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendComment();
  });
}
function openComments(id) {
  ensureDrawer(); cmtOpenId = id; fillDrawer();
  document.getElementById("cmtDrawer").classList.add("open");
}
function closeComments() {
  cmtOpenId = null;
  const d = document.getElementById("cmtDrawer"); if (d) d.classList.remove("open");
}
function fillDrawer() {
  const d = document.getElementById("cmtDrawer"); if (!d) return;
  const n = findNode(cmtOpenId); if (!n) { closeComments(); return; }
  document.getElementById("cmtTitle").textContent = title(n);
  const arr = (n.comments || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  document.getElementById("cmtList").innerHTML = arr.length
    ? arr.map((c) => `<div class="cmt-item"><button class="cmt-del" data-del-cmt="${c.ts}" aria-label="delete">✕</button><div class="cmt-txt">${esc(c.text)}</div><div class="cmt-ts">${fmtTime(c.ts)}</div></div>`).join("")
    : `<div class="cmt-empty">${T[lang].noComments}</div>`;
}
async function sendComment() {
  if (!cmtOpenId) return;
  const ta = document.getElementById("cmtText"); const txt = (ta.value || "").trim();
  if (!txt) return;
  const n = findNode(cmtOpenId); if (!n) return;
  const arr = [...(n.comments || []), { text: txt, ts: Date.now() }];
  ta.value = "";
  try { await updateDoc(doc(db, COL, cmtOpenId), { comments: arr }); }   // onSnapshot обновит панель
  catch (e) { console.error("comment:", e.message); }
}
async function deleteComment(ts) {
  if (!cmtOpenId) return;
  if (!confirm(T[lang].delComment)) return;
  const n = findNode(cmtOpenId); if (!n) return;
  const arr = (n.comments || []).filter((c) => String(c.ts) !== String(ts));
  try { await updateDoc(doc(db, COL, cmtOpenId), { comments: arr }); }
  catch (e) { console.error("comment del:", e.message); }
}

// ---------- события ----------
document.addEventListener("click", (e) => {
  const lb = e.target.closest(".langbtn");
  if (lb) {
    lang = lb.getAttribute("data-lang");
    document.querySelectorAll(".langbtn").forEach((b) => b.classList.toggle("active", b === lb));
    document.documentElement.lang = lang;
    render();
    return;
  }
  // «Назад» — на уровень выше (в родителя), а не сразу на главную
  if (e.target.closest("[data-back]")) {
    const cur = findNode(currentView().id);
    go(cur && cur.parentId ? cur.parentId : "");
    return;
  }
  // удалить комментарий
  const dc = e.target.closest("[data-del-cmt]");
  if (dc) { deleteComment(dc.getAttribute("data-del-cmt")); return; }

  // открыть панель комментариев задачи
  const cm = e.target.closest("[data-cmt]");
  if (cm) { openComments(cm.getAttribute("data-cmt")); return; }

  // свап раздела на передний план (карусель на главном экране)
  const sw = e.target.closest("[data-swap]");
  if (sw) { frontId = sw.getAttribute("data-swap"); render(); return; }

  const op = e.target.closest("[data-open]");
  if (op) { go(op.getAttribute("data-open")); }
});

document.addEventListener("change", (e) => {
  if (e.target.matches('input[type=checkbox][data-id]')) {
    const id = e.target.getAttribute("data-id");
    updateDoc(doc(db, COL, id), { done: e.target.checked });
    // onSnapshot перерисует автоматически
  }
});
