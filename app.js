import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COL = "nodes";

let lang = "ru";
let tree = [];
let seeding = false;
let loaded = false;   // true, когда данные пришли из Firestore

const T = {
  ru: { started: "выполнено", back: "Назад", empty: "Пунктов пока нет — добавьте через админку", finish: "ФИНИШ" },
  en: { started: "done", back: "Back", empty: "No items yet — add them via admin", finish: "FINISH" }
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
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function prioBadge(n) {
  return PRIO_LABEL[n.priority] ? `<span class="prio prio-${n.priority}">${PRIO_LABEL[n.priority]}</span>` : "";
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

// ---------- отрисовка дороги ----------
function home() {
  const N = tree.length;
  const cols = tree.map((_, i) => Math.round((660 * (i + 1)) / (N + 1)));
  const ny = 120, rt = 206, rb = 356, hubY = 44;
  let s = "";

  // линии от Salary Project Roadmap к разделам
  cols.forEach((x) => {
    s += `<line x1="330" y1="${hubY + 14}" x2="${x}" y2="${ny - 28}" stroke="#E8005A" stroke-width="2" stroke-linecap="round" opacity="0.65"/>`;
  });

  // дороги вниз
  cols.forEach((x) => {
    s += `<line x1="${x}" y1="${rt}" x2="${x}" y2="${rb}" stroke="#E8005A" stroke-width="36" stroke-linecap="round" opacity="0.07"/>`;
    s += `<line x1="${x}" y1="${rt}" x2="${x}" y2="${rb}" stroke="#000" stroke-width="30" stroke-linecap="round"/>`;
    s += `<line x1="${x}" y1="${rt}" x2="${x}" y2="${rb}" stroke="#303138" stroke-width="26" stroke-linecap="round"/>`;
    s += `<line x1="${x - 12.5}" y1="${rt}" x2="${x - 12.5}" y2="${rb}" stroke="#5a5b63" stroke-width="1.5"/>`;
    s += `<line x1="${x + 12.5}" y1="${rt}" x2="${x + 12.5}" y2="${rb}" stroke="#5a5b63" stroke-width="1.5"/>`;
    s += `<line x1="${x}" y1="${rt}" x2="${x}" y2="${rb}" stroke="#ff2e88" stroke-width="3" stroke-dasharray="16 15"/>`;
  });

  // финишная линия
  const fx1 = Math.min(...cols) - 40, fx2 = Math.max(...cols) + 40;
  s += `<line x1="${fx1}" y1="364" x2="${fx2}" y2="364" stroke="#E8005A" stroke-width="5" stroke-linecap="round"/>`;
  s += `<text x="330" y="388" text-anchor="middle" font-family="Unbounded,sans-serif" font-size="13" font-weight="700" fill="#E8005A" letter-spacing="2">${T[lang].finish}</text>`;

  // старт
  s += `<circle cx="330" cy="${hubY}" r="20" fill="#E8005A" opacity="0.13"/><circle cx="330" cy="${hubY}" r="9" fill="#E8005A"/>`;
  s += `<text x="330" y="22" text-anchor="middle" font-family="Unbounded,sans-serif" font-size="16" font-weight="700" fill="#E8005A">Salary  Project Roadmap</text>`;

  // разделы
  tree.forEach((sec, i) => {
    const x = cols[i], p = pct(sec), r = 29, C = 2 * Math.PI * r, dash = (p / 100) * C;
    const col = p === 100 ? "#34d399" : "#ff4d92";
    s += `<g data-open="${sec.id}">`;
    s += `<circle cx="${x}" cy="${ny}" r="42" fill="transparent"/>`;
    s += `<circle class="node-bg" cx="${x}" cy="${ny}" r="34" fill="${p === 100 ? "rgba(52,211,153,0.10)" : "rgba(232,0,90,0.08)"}"/>`;
    s += `<circle cx="${x}" cy="${ny}" r="${r}" fill="#141414" stroke="#2e2e2e" stroke-width="6"/>`;
    s += `<circle cx="${x}" cy="${ny}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${dash} ${C}" transform="rotate(-90 ${x} ${ny})"/>`;
    s += `<text x="${x}" y="${ny + 6}" text-anchor="middle" font-size="15" font-weight="500" fill="#fff">${p}%</text>`;
    const ln = wrap2(title(sec));
    const yb = ln.length === 1 ? ny + 58 : ny + 52;
    ln.forEach((line, k) => {
      s += `<text x="${x}" y="${yb + k * 16}" text-anchor="middle" font-family="Unbounded,sans-serif" font-size="12.5" font-weight="500" fill="#f2f2f2">${esc(line)}</text>`;
    });
    s += `</g>`;
  });

  setLeft(`<span class="overall">${pct({ children: tree })}% ${T[lang].started}</span>`);
  document.getElementById("stage").innerHTML =
    `<div class="panel"><svg viewBox="0 0 660 404" role="img" aria-label="Salary Project Roadmap">${s}</svg></div>`;
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
      h += `<label class="row task${g ? " done" : ""}">` +
        `<input type="checkbox" data-id="${c.id}" ${g ? "checked" : ""}>` +
        `<span class="name">${esc(title(c))}</span>` +
        prioBadge(c) +
        (g ? `<i class="ti ti-circle-check" style="color:var(--success)"></i>` : "") +
        `</label>`;
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
    return;
  }
  const view = currentView();
  if (view.t === "home") return home();

  const node = findNode(view.id);
  // Узел не найден в текущих данных — сразу показываем главную, НЕ зависаем и НЕ ждём базу.
  // Если узел придёт из базы позже — onSnapshot снова вызовет render() и откроет его.
  if (!node) return home();
  page(node);
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
