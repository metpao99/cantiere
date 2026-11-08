"use strict";
/* Cantiere – interfaccia della chat con Claude Code sul NAS */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const touch = matchMedia("(pointer:coarse)").matches;

const S = { convs: [], cur: null, msgs: [], live: null, es: null, files: [], browse: "", tbrowse: "",
  tab: localStorage.getItem("cantiere-tab") || "chat", teams: [], team: null, poll: 0,
  teamView: localStorage.getItem("cantiere-teamview") || "log" };

/* ---------- collegamento col NAS: avviso in alto e nuovi tentativi ---------- */
const NET = { down: false, timer: 0, okTimer: 0, onBack: null, why: "" };
function netShow() {
  const n = $("#net"); clearTimeout(NET.okTimer);
  n.className = ""; n.hidden = false;
  n.innerHTML = `<span class="spin"></span><span>${esc(NET.why)} · riprovo…</span>`;
  const b = el("button", "", "Riprova"); b.type = "button"; b.onclick = () => ping(true); n.append(b);
}
function setDown(why) {
  NET.why = navigator.onLine === false ? "Il telefono è senza rete" : why || "Non collegato al NAS";
  if (!NET.down) { NET.down = true; }
  netShow(); schedulePing(4000);
}
function setUp() {
  if (!NET.down) return;
  NET.down = false;
  const n = $("#net"); n.className = "ok"; n.textContent = "Di nuovo collegato"; n.hidden = false;
  NET.okTimer = setTimeout(() => n.hidden = true, 2000);
  const f = NET.onBack; NET.onBack = null;
  if (f) f(); else if (!$("#app").hidden) refreshAll();
}
function schedulePing(ms) { clearTimeout(NET.timer); NET.timer = setTimeout(() => ping(), ms); }
async function ping(manual) {
  if (document.visibilityState !== "visible" && !manual) return schedulePing(15000);
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch("/api/state", { credentials: "same-origin", cache: "no-store", signal: ctl.signal });
    clearTimeout(to);
    if (r.status >= 500) throw new Error();
    const s = await r.json();   // se risponde qualcos'altro (es. pagina d'errore) non è il Cantiere
    setUp(); schedulePing(20000);
    return s;
  } catch { setDown(NET.why && NET.down ? NET.why : "Il NAS non risponde (spento o fuori rete?)"); }
}
function refreshAll() {
  loadConvs().catch(() => {}); notifyUpdate();
  if (S.team) loadTeam(S.team.id, true);
  if (S.cur) { closeStream(); S.live = null; loadConv(S.cur.id, true); }
}
addEventListener("offline", () => setDown("Il telefono è senza rete"));
addEventListener("online", () => ping(true));

async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(path, o); }
  catch { setDown("Non collegato al NAS"); throw new Error("NAS non raggiungibile: riprova quando torna il collegamento"); }
  if (r.status === 502 || r.status === 503 || r.status === 504) { setDown("Il server del Cantiere non risponde"); throw new Error("Il server del Cantiere non risponde"); }
  setUp();
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== "/api/login") { showLogin(); throw new Error(data.error || "Accedi"); }
  if (!r.ok) throw new Error(data.error || `Errore ${r.status}`);
  return data;
}


/* ---------- temi (contrasti verificati: testo ≥ 7:1, testo secondario/link/pulsanti ≥ 4,5:1, sia chiaro sia scuro) ---------- */
const THEMES = {"mare": {"name": "Mare", "light": {"--bg": "#f2f5f8", "--card": "#fbfcfe", "--fg": "#16212b", "--muted": "#55636f", "--line": "#d5dde5", "--accent": "#1f5f8b", "--accent-fg": "#f4f8fb", "--soft": "#dfeaf3", "--warn": "#8a5e00", "--warn-bg": "#f6ebcc", "--bad": "#a3361f", "--bad-bg": "#f6dcd4", "--code-bg": "#e9eef3"}, "dark": {"--bg": "#0f161d", "--card": "#17212b", "--fg": "#e4ebf1", "--muted": "#9aabbb", "--line": "#2a3744", "--accent": "#7db9e8", "--accent-fg": "#0b1a26", "--soft": "#18293a", "--warn": "#e2b04a", "--warn-bg": "#3a2f12", "--bad": "#ec8a72", "--bad-bg": "#3d1d15", "--code-bg": "#0b1218"}}, "salvia": {"name": "Salvia", "light": {"--bg": "#f3f5f0", "--card": "#fbfcf9", "--fg": "#1c241c", "--muted": "#55614e", "--line": "#d6ddd0", "--accent": "#3b6843", "--accent-fg": "#f3f8f2", "--soft": "#e2eadc", "--warn": "#805b06", "--warn-bg": "#f4ebcf", "--bad": "#a3361f", "--bad-bg": "#f5ddd5", "--code-bg": "#e8ede3"}, "dark": {"--bg": "#121812", "--card": "#1a221a", "--fg": "#e3eadf", "--muted": "#a0ad99", "--line": "#2c3a2c", "--accent": "#8fc79a", "--accent-fg": "#0f1d12", "--soft": "#1f2d21", "--warn": "#dcb257", "--warn-bg": "#3a2f13", "--bad": "#ec8a72", "--bad-bg": "#3d1d15", "--code-bg": "#0d130d"}}, "terracotta": {"name": "Terracotta", "light": {"--bg": "#f8f4f0", "--card": "#fdfbf9", "--fg": "#2a1d17", "--muted": "#69554a", "--line": "#e3d8cf", "--accent": "#9c4327", "--accent-fg": "#fdf6f2", "--soft": "#f1e4da", "--warn": "#805800", "--warn-bg": "#f5e9c8", "--bad": "#a12b2b", "--bad-bg": "#f6dada", "--code-bg": "#efe7df"}, "dark": {"--bg": "#1a1310", "--card": "#241a16", "--fg": "#f0e6df", "--muted": "#b9a497", "--line": "#3a2c25", "--accent": "#eb9a7a", "--accent-fg": "#2a120a", "--soft": "#2f211b", "--warn": "#e2b04a", "--warn-bg": "#3a2f12", "--bad": "#f08a8a", "--bad-bg": "#3f1a1a", "--code-bg": "#130d0b"}}, "lavanda": {"name": "Lavanda", "light": {"--bg": "#f5f3f8", "--card": "#fcfbfe", "--fg": "#221c2b", "--muted": "#5d546a", "--line": "#dcd6e4", "--accent": "#5a499c", "--accent-fg": "#f6f4fc", "--soft": "#e7e2f1", "--warn": "#805b06", "--warn-bg": "#f4ebcf", "--bad": "#a3361f", "--bad-bg": "#f6dcd4", "--code-bg": "#ebe7f1"}, "dark": {"--bg": "#15121b", "--card": "#1e1a26", "--fg": "#e9e4f1", "--muted": "#a89fb8", "--line": "#332c40", "--accent": "#b5a5f0", "--accent-fg": "#1a1233", "--soft": "#252036", "--warn": "#e2b04a", "--warn-bg": "#3a2f12", "--bad": "#ec8a72", "--bad-bg": "#3d1d15", "--code-bg": "#100d15"}}, "grafite": {"name": "Grafite", "light": {"--bg": "#f4f4f5", "--card": "#fcfcfc", "--fg": "#18181b", "--muted": "#595961", "--line": "#dcdce0", "--accent": "#2f2f35", "--accent-fg": "#fafafa", "--soft": "#e6e6e9", "--warn": "#805b06", "--warn-bg": "#f4ebcf", "--bad": "#a3361f", "--bad-bg": "#f6dcd4", "--code-bg": "#eaeaec"}, "dark": {"--bg": "#111113", "--card": "#1b1b1e", "--fg": "#ececee", "--muted": "#a1a1aa", "--line": "#2e2e33", "--accent": "#e4e4e7", "--accent-fg": "#18181b", "--soft": "#232327", "--warn": "#e2b04a", "--warn-bg": "#3a2f12", "--bad": "#ec8a72", "--bad-bg": "#3d1d15", "--code-bg": "#0c0c0e"}}};
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = THEMES[localStorage.getItem("cantiere-theme")] || THEMES.mare;
  const sch = localStorage.getItem("cantiere-scheme") || "auto";
  const dark = sch === "dark" || (sch === "auto" && darkMQ.matches);
  const root = document.documentElement, p = t[dark ? "dark" : "light"];
  for (const [k, v] of Object.entries(p)) root.style.setProperty(k, v);
  root.style.colorScheme = dark ? "dark" : "light";
  root.classList.toggle("dark", dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.content = p["--bg"]);
}
function renderThemes() {
  const box = $("#themes"); if (!box) return;
  const cur = localStorage.getItem("cantiere-theme") || "mare", dark = document.documentElement.classList.contains("dark");
  box.innerHTML = "";
  for (const [k, t] of Object.entries(THEMES)) {
    const p = t[dark ? "dark" : "light"], b = el("button", "theme");
    b.type = "button"; b.setAttribute("aria-pressed", k === cur ? "true" : "false");
    b.innerHTML = `<span class="sw" style="background:${p["--bg"]};border-color:${p["--line"]}"><i style="background:${p["--accent"]}"></i><i style="background:${p["--soft"]}"></i></span>${esc(t.name)}`;
    b.onclick = () => { localStorage.setItem("cantiere-theme", k); applyTheme(); renderThemes(); };
    box.append(b);
  }
  $("#schemeSel").value = localStorage.getItem("cantiere-scheme") || "auto";
  $("#sbSel").value = localStorage.getItem("cantiere-statusbar") === "glass" ? "glass" : "auto";
}
applyTheme();
darkMQ.addEventListener("change", () => { applyTheme(); renderThemes(); });

/* ---------- Markdown essenziale (il testo viene sempre ripulito prima) ---------- */
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
       .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
       .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}
/* colori del codice: piccolo evidenziatore (commenti, testi, numeri, parole chiave, funzioni) */
const KW = new Set(("if else elif for while do return function def class import from export const let var new try catch except finally " +
  "raise throw with as in of not and or is async await yield break continue pass lambda true false null None True False undefined " +
  "this self switch case default static public private void int float str bool dict list echo then fi done esac local source " +
  "select insert update delete where create table into values set struct impl fn pub use mod match enum interface type extends").split(" "));
function highlight(code, lang) {
  const hash = /^(py|python|sh|bash|shell|zsh|yaml|yml|toml|ini|conf|r|rb|ruby|dockerfile|make|makefile|)$/i.test(lang || "");
  const slash = !/^(py|python|sh|bash|shell|zsh|yaml|yml|toml|ini|conf)$/i.test(lang || "");
  const parts = [
    /("""[\s\S]*?"""|'''[\s\S]*?''')/.source,
    slash ? /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/.source : "((?!))",
    hash ? /(#[^\n]*)/.source : "((?!))",
    /(<!--[\s\S]*?-->)/.source,
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/.source,
    /(\b\d+(?:\.\d+)?\b)/.source,
    /([A-Za-z_$][\w$]*)(?=\s*\()/.source,
    /([A-Za-z_$][\w$]*)/.source,
  ];
  const re = new RegExp(parts.join("|"), "g");
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index === re.lastIndex) { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index)); last = re.lastIndex;
    const t = m[0], cls = m[1] ? "s" : m[2] || m[3] || m[4] ? "c" : m[5] ? "s" : m[6] ? "n" : m[7] ? (KW.has(t) ? "k" : "f") : KW.has(t) ? "k" : "";
    out += cls ? `<span class="tk-${cls}">${esc(t)}</span>` : esc(t);
  }
  return out + esc(code.slice(last));
}
function md(src) {
  const L = String(src || "").split("\n"), out = [];
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const isTable = i => /^\s*\|.*\|\s*$/.test(L[i]) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1]);
  const special = i => /^\s*```/.test(L[i]) || /^#{1,6}\s/.test(L[i]) || isList(L[i]) || /^\s*>/.test(L[i]) || isTable(i) || /^\s*(-{3,}|\*{3,})\s*$/.test(L[i]);
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    const fence = l.match(/^\s*```\s*([\w+.#-]*)/);
    if (fence) {
      const buf = []; i++;
      while (i < L.length && !/^\s*```\s*$/.test(L[i])) buf.push(L[i++]);
      i++;
      out.push(`<div class="code"><div class="codebar"><span>${esc(fence[1])}</span><button type="button" class="copy">Copia</button></div><pre><code>${buf.length > 400 ? esc(buf.join("\n")) : highlight(buf.join("\n"), fence[1])}</code></pre></div>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(esc(h[2]))}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (isTable(i)) {
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(esc(c.trim())));
      const head = cells(L[i]); i += 2; const rows = [];
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < L.length && /^\s*>/.test(L[i])) buf.push(L[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${md(buf.join("\n"))}</blockquote>`); continue;
    }
    if (isList(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (isList(L[i])) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += "\n" + L[i].trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map(t => `<li>${inline(esc(t)).replace(/\n/g, "<br>")}</li>`).join("")}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < L.length && L[i].trim() && !special(i)) buf.push(L[i++]);
    out.push(`<p>${buf.map(b => inline(esc(b))).join("<br>")}</p>`);
  }
  return out.join("");
}

/* ---------- icone ---------- */
const ICON = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
};
const TOOL_NAMES = { Bash: "Comando", Read: "Legge", Write: "Scrive", Edit: "Modifica", MultiEdit: "Modifica", Glob: "Cerca file",
  Grep: "Cerca testo", WebFetch: "Apre pagina", WebSearch: "Cerca sul web", Task: "Sotto-agente", Agent: "Sotto-agente",
  TodoWrite: "Piano", NotebookEdit: "Notebook" };

/* ---------- disegno dei messaggi ---------- */
function toolEl(b) {
  const d = el("details", "tool " + (b.status || "run"));
  d.dataset.id = b.id;
  const st = b.status === "ok" ? ICON.ok : (b.status === "err" || b.status === "stop") ? ICON.err : '<span class="spin"></span>';
  d.innerHTML = `<summary><span class="st">${st}</span><span class="nm">${esc(TOOL_NAMES[b.name] || b.name)}</span><span class="sm">${esc(b.summary)}</span></summary>`
    + (b.detail ? `<pre>${esc(b.detail)}</pre>` : "") + (b.result ? `<pre>${esc(b.result)}</pre>` : "");
  return d;
}
function botBlocks(box, blocks) {
  box.innerHTML = "";
  for (const b of blocks) {
    if (b.type === "text" && b.text.trim()) { const t = el("div", "md"); t.innerHTML = md(b.text); box.append(t); }
    else if (b.type === "tool") box.append(toolEl(b));
  }
}
function metaEl(meta) {
  const f = document.createDocumentFragment();
  if (meta.error) f.append(el("div", "note bad", esc(meta.error)));
  if (meta.stopped) f.append(el("div", "note warn", "Risposta fermata."));
  if (meta.denied && meta.denied.length) f.append(el("div", "note warn",
    `Claude voleva usare <b>${esc(meta.denied.map(n => TOOL_NAMES[n] || n).join(", "))}</b> ma la modalità scelta non lo permette. Se ti va bene, passa ad <b>Autonomo</b> e scrivi «continua».`));
  const bits = [];
  if (meta.seconds != null) bits.push(meta.seconds >= 60 ? `${Math.floor(meta.seconds / 60)} min ${meta.seconds % 60} s` : `${meta.seconds} s`);
  if (bits.length) f.append(el("div", "metaline", bits.join(" · ")));
  return f;
}
function msgEl(m) {
  if (m.role === "user") {
    const d = el("div", "msg user");
    const t = m.blocks.find(b => b.type === "text"); d.textContent = t ? t.text : "";
    const f = m.blocks.find(b => b.type === "files");
    if (f) { const fs = el("div", "files"); f.files.forEach(n => fs.append(el("span", "filechip", esc(n.replace(/^allegati\/\d{8}-\d{6}-/, ""))))); d.append(fs); }
    return d;
  }
  const d = el("div", "msg bot"); const box = el("div"); botBlocks(box, m.blocks); d.append(box, metaEl(m.meta || {}));
  return d;
}
/* "incollato in fondo": lo decide solo chi scorre col dito. Se sei in fondo ci resti qualunque cosa cambi
   (testo che arriva, barra in vetro che cambia altezza, tastiera): prima i puntini finivano sotto la barra */
const STICK = { on: true };
function nearBottom() { return STICK.on; }
function toBottom() { const s = $("#scroller"); STICK.on = true; s.scrollTop = s.scrollHeight; }
function initStick() {
  const s = $("#scroller");
  s.addEventListener("scroll", () => {
    STICK.on = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  }, { passive: true });
  const keep = () => { if (STICK.on) toBottom(); };
  new ResizeObserver(keep).observe(s);
  new ResizeObserver(keep).observe($("#msgs"));
  if (window.visualViewport) visualViewport.addEventListener("resize", keep);
}

/* animo solo quello che compare di nuovo (non tutto a ogni ridisegno) */
const SEEN = { scope: null, keys: new Set() };
function animNew(node, scope, key) {
  if (SEEN.scope !== scope) { SEEN.scope = scope; SEEN.keys = new Set(); SEEN.fresh = true; }
  if (!SEEN.keys.has(key)) { SEEN.keys.add(key); if (!SEEN.fresh) node.classList.add("anim"); }
  return node;
}
function renderMsgs() {
  const box = $("#msgs"); box.innerHTML = "";
  if (!S.cur) {
    box.append(el("div", "empty", S.tab === "team"
      ? `<h2>Team</h2><p>Più sessioni di Claude, ognuna nella sua cartella, che si passano il lavoro. Tu scrivi al capo e segui lo scambio.</p><button class="btn" id="emptyNew">Nuovo team</button>`
      : `<h2>Ciao!</h2><p>Apri una conversazione: scegli una cartella del NAS e Claude ci lavora dentro con te.</p><button class="btn" id="emptyNew">Nuova conversazione</button>`));
    $("#emptyNew").onclick = openNew; return;
  }
  if (!S.msgs.length && !S.live) box.append(el("div", "empty", `<p>Claude lavora in <code>${esc(S.cur.folder || "~")}</code>. Chiedigli cosa vuoi costruire.</p>`));
  S.msgs.forEach((m, i) => box.append(animNew(msgEl(m), "c" + S.cur.id, m.role + i)));
  if (S.live) { S.live.node = animNew(el("div", "msg bot"), "c" + S.cur.id, "assistant" + S.msgs.length); box.append(S.live.node); drawLive(); }
  SEEN.fresh = false;
  toBottom();
}
let raf = 0;
function drawLive() {
  if (!S.live || !S.live.node) return;
  const stick = nearBottom();
  const n = S.live.node; n.innerHTML = "";
  const box = el("div"); botBlocks(box, S.live.blocks); n.append(box);
  const last = S.live.blocks[S.live.blocks.length - 1];
  if (!last || last.type !== "text" || !last.text) n.append(el("div", "thinking", '<span class="dots"><i></i><i></i><i></i></span>Claude sta lavorando…'));
  else { const mds = n.querySelectorAll(".md"), t = mds[mds.length - 1]; if (t) (t.lastElementChild || t).append(el("span", "caret")); }
  if (stick) toBottom();
}
const scheduleDraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawLive(); }); };

/* ---------- flusso della risposta in corso ---------- */
function closeStream() { if (S.es) { S.es.close(); S.es = null; } }
function openStream(id) {
  closeStream();
  S.live = { blocks: [], node: null };
  const es = new EventSource(`/api/convs/${id}/events`);
  S.es = es;
  es.onmessage = e => {
    if (!S.cur || S.cur.id !== id) return closeStream();
    const ev = JSON.parse(e.data), L = S.live;
    if (ev.op === "text_start") L.blocks.push({ type: "text", text: "" });
    else if (ev.op === "text") { const b = L.blocks[L.blocks.length - 1]; if (b && b.type === "text") b.text += ev.d; else L.blocks.push({ type: "text", text: ev.d }); }
    else if (ev.op === "tool") L.blocks.push(ev.block);
    else if (ev.op === "result") { const b = L.blocks.find(x => x.id === ev.id); if (b) { b.status = ev.status; b.result = ev.result; } }
    else if (ev.op === "done" || ev.op === "idle") { closeStream(); S.live = null; loadConv(id, true); loadConvs(); return; }
    scheduleDraw();
  };
  es.onerror = () => { ping(); if (es.readyState === EventSource.CLOSED) { S.es = null; setTimeout(() => S.cur && S.cur.id === id && loadConv(id, true), 2000); } };
  setBusy(true);
}
function setBusy(b) {
  const s = $("#sendBtn"); s.classList.toggle("stop", b); s.innerHTML = b ? ICON.stop : ICON.send;
  s.setAttribute("aria-label", b ? "Ferma" : "Invia");
}

/* ---------- conversazioni ---------- */
function ago(t) {
  const s = Date.now() / 1000 - t;
  if (s < 60) return "ora"; if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  const d = new Date(t * 1000), today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
function renderTabs() {
  const busy = { chat: S.convs.some(c => c.running), team: S.teams.some(t => t.running) };
  document.querySelectorAll(".tabs button").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.tab === S.tab ? "true" : "false");
    let d = b.querySelector(".dot");
    if (busy[b.dataset.tab] && !d) { d = el("span", "dot"); d.title = "Qualcuno sta lavorando"; b.append(d); }
    else if (!busy[b.dataset.tab] && d) d.remove();
  });
  /* sul telefono il menu è chiuso: il pallino compare anche sul pulsante ≡ */
  const mb = $("#menuBtn"), any = busy.chat || busy.team, md = mb.querySelector(".dot");
  if (any && !md) mb.append(el("span", "dot")); else if (!any && md) md.remove();
  $("#newLbl").textContent = S.tab === "team" ? "Nuovo team" : "Nuova conversazione";
}
function setTab(t) { S.tab = t; localStorage.setItem("cantiere-tab", t); renderTabs(); renderList(); if (t === "team") loadTeams().catch(() => {}); if (!S.cur && !S.team) renderMsgs(); }
function renderList() {
  renderTabs();
  if (S.tab === "team") return renderTeamList();
  const nav = $("#convList"); nav.innerHTML = "";
  if (!S.convs.length) { const p = el("p", "muted small", "Nessuna conversazione."); p.style.padding = "4px 10px"; nav.append(p); }
  for (const c of S.convs) {
    const b = el("button", "conv");
    b.setAttribute("aria-current", S.cur && S.cur.id === c.id ? "true" : "false");
    b.innerHTML = `<div class="t">${c.running ? '<span class="dot" title="Al lavoro"></span>' : ""}<span>${esc(c.title)}</span></div><div class="s">${esc(c.folder || "~")} · ${ago(c.updated)}</div>`;
    b.onclick = () => { go(c.id); closeSide(); };
    nav.append(b);
  }
}
async function loadConvs() { S.convs = (await api("/api/convs")).convs; renderList(); loadTeams().catch(() => {}); }
async function loadConv(id, keepScroll) {
  try {
    const d = await api(`/api/convs/${id}`);
    if (location.hash.slice(1) !== id) return;
    S.cur = d.conv; S.msgs = d.msgs; S.team = null; stopPoll(); composerFor("chat");
    $("#backTeam").hidden = !d.conv.team_id; $("#backTeam").dataset.team = d.conv.team_id || "";
    $("#convTitle").textContent = d.conv.title; $("#convFolder").textContent = (d.conv.team_id ? "membro del team · " : "") + "~/" + d.conv.folder;
    $("#moreBtn").hidden = false; $("#composer").hidden = false;
    $("#modeSel").value = d.conv.mode; $("#modelSel").value = d.conv.model; $("#effortSel").value = d.conv.effort || ""; paintEffort(); paintMode();
    if (d.conv.running) { if (!S.es) openStream(id); else S.live = S.live || { blocks: [] }; }
    else { closeStream(); S.live = null; setBusy(false); }
    renderMsgs(); renderList();
  } catch (e) { toast(e.message); go(""); }
}
/* navigazione senza cronologia: così iOS non offre il "torna indietro" col dito, che si sovrapponeva al menu */
function go(h) {
  const nav = () => { history.replaceState(null, "", h ? "#" + h : location.pathname + location.search); return route(); };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion:reduce)").matches)
    document.startViewTransition(() => Promise.race([nav(), new Promise(r => setTimeout(r, 1500))]));
  else nav();
}
function route() {
  const id = location.hash.slice(1);
  closeStream(); S.live = null; setBusy(false); stopPoll(); $("#backTeam").hidden = true;
  if (id.startsWith("t-")) { S.cur = null; if (S.tab !== "team") setTab("team"); return loadTeam(id.slice(2)); }
  S.team = null; composerFor("chat");
  if (!id) {
    S.cur = null; S.msgs = [];
    $("#convTitle").textContent = "Cantiere"; $("#convFolder").textContent = "";
    $("#moreBtn").hidden = true; $("#composer").hidden = true; renderMsgs(); renderList(); return;
  }
  return loadConv(id);
}

/* ---------- invio ---------- */
async function send(e) {
  e.preventDefault();
  if (S.team) return teamSend();
  if (!S.cur) return;
  if (S.es || S.live) { try { await api(`/api/convs/${S.cur.id}/stop`, { method: "POST", body: {} }); } catch (err) { toast(err.message); } return; }
  const text = $("#input").value.trim();
  if (!text && !S.files.length) return;
  const files = S.files.map(f => ({ name: f.name, data: f.data }));
  $("#sendBtn").disabled = true;
  try {
    await api(`/api/convs/${S.cur.id}/send`, { method: "POST", body: { text, files } });
    S.msgs.push({ role: "user", blocks: [{ type: "text", text }].concat(files.length ? [{ type: "files", files: files.map(f => f.name) }] : []) });
    $("#input").value = ""; autosize(); S.files = []; renderPending();
    if (S.cur.title === "Nuova conversazione" && text) $("#convTitle").textContent = S.cur.title = text.replace(/\s+/g, " ").slice(0, 60);
    openStream(S.cur.id); renderMsgs(); loadConvs();
  } catch (err) { toast(err.message); }
  finally { $("#sendBtn").disabled = false; }
}
function autosize() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, innerHeight * 0.4) + "px"; }

/* allegati: le foto grandi vengono ridotte (meno attesa e meno consumo) */
function readFile(file) {
  return new Promise((res, rej) => {
    const big = /^image\/(jpeg|png|heic|heif|webp)$/.test(file.type) && file.size > 600 * 1024;
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("Non riesco a leggere " + file.name));
    fr.onload = () => {
      if (!big) return res({ name: file.name, data: fr.result.split(",")[1] });
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res({ name: file.name.replace(/\.\w+$/, "") + ".jpg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
      };
      img.onerror = () => res({ name: file.name, data: fr.result.split(",")[1] });
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function addFiles(list) {
  for (const f of list) {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: troppo grande (max 15 MB)`); continue; }
    try { S.files.push(await readFile(f)); } catch (e) { toast(e.message); }
  }
  renderPending();
}
function renderPending() {
  const p = $("#pending"); p.innerHTML = "";
  S.files.forEach((f, i) => {
    const c = el("span", "filechip", `${esc(f.name)} <button type="button" aria-label="Togli">×</button>`);
    c.querySelector("button").onclick = () => { S.files.splice(i, 1); renderPending(); };
    p.append(c);
  });
}

/* ---------- opzioni della conversazione ---------- */
function paintMode() { const s = $("#modeSel"); s.className = "mode-" + s.value; }
async function patchConv(body) {
  try { const d = await api(`/api/convs/${S.cur.id}`, { method: "PATCH", body }); S.cur = d.conv; $("#convTitle").textContent = d.conv.title; loadConvs(); }
  catch (e) { toast(e.message); }
}
async function more() {
  if (S.team) return openTeamOpts();
  if (S.cur) openConvDlg(S.cur);
}

/* ---------- nuova conversazione: scelta della cartella ---------- */
async function browse(path, t) {
  const k = t === true ? "t" : (t || ""), nav = p => browse(p, k);
  try {
    const d = await api("/api/folders?path=" + encodeURIComponent(path));
    S[k + "browse"] = d.path;
    $(k ? `#${k}Crumb` : "#crumb").textContent = d.root + (d.path ? "/" + d.path : "") + "/";
    const box = $(k ? `#${k}Dirs` : "#dirs"); box.innerHTML = "";
    if (d.parent !== null) { const up = el("button", "", ICON.up + "<span>Cartella superiore</span>"); up.type = "button"; up.onclick = () => nav(d.parent); box.append(up); }
    d.dirs.forEach(n => { const b = el("button", "", ICON.folder + `<span>${esc(n)}</span>`); b.type = "button"; b.onclick = () => nav((d.path ? d.path + "/" : "") + n); box.append(b); });
    if (!d.dirs.length) { const p = el("p", "muted small", "Nessuna sottocartella."); p.style.padding = "4px 12px"; box.append(p); }
  } catch (e) { toast(e.message); }
}
function openNew() { if (S.tab === "team") return openNewTeam(); closeSide(); $("#newDir").value = ""; browse(S.browse || ""); $("#newDlg").showModal(); }
async function mkdir() {
  const name = $("#newDir").value.trim(); if (!name) return;
  try { const d = await api("/api/folders", { method: "POST", body: { path: S.browse, name } }); $("#newDir").value = ""; browse(d.path); }
  catch (e) { toast(e.message); }
}
async function createConv(e) {
  if (e.submitter && e.submitter.value !== "ok") return;
  e.preventDefault();
  const mode = new FormData($("#newForm")).get("mode");
  try {
    const d = await api("/api/convs", { method: "POST", body: { folder: S.browse, mode, model: localStorage.getItem("cantiere-model") || "", effort: localStorage.getItem("cantiere-effort") || "" } });
    $("#newDlg").close(); await loadConvs(); go(d.conv.id); setTimeout(() => $("#input").focus(), 50);
  } catch (err) { toast(err.message); }
}


/* ---------- team: più sessioni di Claude che si scrivono ---------- */
const MODE_LBL = { plan: "Solo piano", acceptEdits: "Modifica file", bypassPermissions: "Autonomo" };
const MODEL_LBL = { "": "Modello predefinito", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const opts = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("");
function composerFor(kind) {
  const team = kind === "team";
  $("#toSel").hidden = !team;
  ["#modeSel", "#modelSel", "#effortSel"].forEach(s => $(s).hidden = team);
  $("#input").placeholder = team ? "Scrivi al team…" : "";
}
async function loadTeams() { S.teams = (await api("/api/teams")).teams; if (S.tab === "team") renderTeamList(); renderTabs(); }
/* le liste si aggiornano da sole: ogni 5 s se qualcuno lavora, se no ogni 20 s (solo con l'app in primo piano) */
function listLoop() {
  const busy = S.convs.some(c => c.running) || S.teams.some(t => t.running);
  setTimeout(async () => {
    if (document.visibilityState === "visible" && !$("#app").hidden && !NET.down) { try { await loadConvs(); } catch {} }
    listLoop();
  }, busy ? 5000 : 20000);
}
function renderTeamList() {
  const nav = $("#convList"); nav.innerHTML = "";
  if (!S.teams.length) { const p = el("p", "muted small", "Nessun team. Un team è un gruppo di sessioni di Claude che si passano il lavoro."); p.style.padding = "4px 10px"; nav.append(p); }
  for (const t of S.teams) {
    const b = el("button", "conv");
    b.setAttribute("aria-current", S.team && S.team.id === t.id ? "true" : "false");
    b.innerHTML = `<div class="t">${t.running ? '<span class="dot" title="Al lavoro"></span>' : ""}<span>${esc(t.title)}</span></div><div class="s">${esc(t.members.map(m => m.role).join(", "))} · ${ago(t.updated)}</div>`;
    b.onclick = () => { go("t-" + t.id); closeSide(); };
    nav.append(b);
  }
}
function stopPoll() { clearTimeout(S.poll); S.poll = 0; }
async function loadTeam(id, quiet) {
  stopPoll();
  let d; try { d = await api(`/api/teams/${id}`); } catch (e) { toast(e.message); go(""); return; }
  if (location.hash.slice(1) !== "t-" + id) return;
  const t = d.team, first = !S.team || S.team.id !== t.id, stick = first || nearBottom();
  const changed = first || JSON.stringify(t) !== JSON.stringify(S.team);
  S.team = t; S.cur = null;
  $("#convTitle").textContent = t.title; $("#convFolder").textContent = `team · ~/${t.folder} · ${t.members.length} membri`;
  $("#moreBtn").hidden = false; $("#composer").hidden = false; composerFor("team");
  const sel = $("#toSel"), keep = sel.value;
  sel.innerHTML = t.members.map(m => `<option value="${esc(m.role)}">a: ${esc(m.role)}</option>`).join("");
  if (t.members.some(m => m.role === keep)) sel.value = keep;
  if (changed || S.teamView === "office") { renderTeam(); if (stick && S.teamView !== "office") toBottom(); }   // l'ufficio si aggiorna sempre (tempi)
  if (S.tab === "team") renderTeamList();   // se stai guardando le Chat, il team aggiornato non deve rubarti la lista
  S.poll = setTimeout(() => loadTeam(id, true), t.running ? 2500 : 15000);
}
function teamColors(t) { const c = {}; t.members.forEach((m, i) => c[m.role] = "c" + (i % 6)); return c; }
function chipsEl(t, color, lastWork) {
  const box = $("#msgs"), oldChips = box.querySelector(".members"), keepX = oldChips && oldChips.dataset.team === t.id ? oldChips.scrollLeft : 0;
  const chips = el("div", "members");
  const sw = el("div", "vsw");
  for (const [v, lbl] of [["log", "Cronologia"], ["office", "Ufficio"]]) {
    const b = el("button", "", lbl); b.type = "button"; b.setAttribute("aria-pressed", S.teamView === v ? "true" : "false");
    b.onclick = () => { if (S.teamView === v) return; S.teamView = v; localStorage.setItem("cantiere-teamview", v); $("#msgs").innerHTML = ""; renderTeam(); if (v === "log") toBottom(); };
    sw.append(b);
  }
  chips.append(sw);
  t.members.forEach(m => {
    const c = el("button", "chip " + color[m.role]); c.type = "button";
    c.innerHTML = `${m.running ? '<span class="spin"></span>' : ""}<b>${esc(m.role)}</b>${!m.running && lastWork[m.role] && lastWork[m.role].denied ? '<span class="warn" title="Bloccato da un permesso">!</span>' : ""}<span class="q">${esc(MODE_LBL[m.mode] || "")}${m.model ? " · " + esc(MODEL_LBL[m.model]) : ""}${m.queued ? ` · ${m.queued} in coda` : ""}</span>`;
    c.title = "Impostazioni di " + m.role; c.onclick = () => openConvDlg(m);
    chips.append(c);
  });
  chips.dataset.team = t.id;
  requestAnimationFrame(() => chips.scrollLeft = keepX);   // il ridisegno automatico non deve riportare la riga all'inizio
  return chips;
}
function renderTeam() {
  const t = S.team, box = $("#msgs");
  const color = teamColors(t);
  const lastWork = {}; t.timeline.forEach(it => { if (it.kind === "work") lastWork[it.role] = it; });
  if (S.teamView === "office") return renderOffice(t, color, lastWork);
  const chips = chipsEl(t, color, lastWork);
  box.innerHTML = "";
  box.append(chips);
  if (!t.timeline.length) box.append(el("div", "empty", `<p>Scrivi al team: il messaggio va a <b>${esc(t.members[0].role)}</b> (o a chi scegli in basso). I membri si passano il lavoro da soli e tu vedi qui tutto lo scambio. Tocca un membro per aprire la sua chat completa.</p>`));
  const conv = {}; t.members.forEach(m => conv[m.role] = m.id);
  let idx = 0;
  for (const it of t.timeline) {
    const key = `${it.conv}-${it.kind}-${it.created}-${idx++}`;
    if (it.kind === "msg") {
      const me = it.from === "tu", n = el("div", "tl-msg " + (me ? "me" : color[it.from] || "c0"));
      n.innerHTML = `<div class="hd">${me ? "Tu" : `<span class="role ${color[it.from]}">${esc(it.from)}</span>`} → <span class="role ${color[it.role]}">${esc(it.role)}</span></div>`;
      n.append(document.createTextNode(it.text));
      if (it.files && it.files.length) { const fs = el("div", "files"); it.files.forEach(f => fs.append(el("span", "filechip", esc(f.replace(/^allegati\/\d{8}-\d{6}-/, ""))))); n.append(fs); }
      box.append(animNew(n, "t" + t.id, key));
    } else {
      const n = el("div", "tl-work " + color[it.role]);
      n.innerHTML = `<div class="hd"><span class="role">${esc(it.role)}</span></div>` + (it.text ? `<div class="md">${md(it.text)}</div>` : "");
      if (it.error) n.append(el("div", "note bad", esc(it.error)));
      if (it.stopped) n.append(el("div", "note warn", "Fermato."));
      if (it.denied && it.denied.length) {
        const w = el("div", "note warn", `Bloccato: voleva usare <b>${esc(it.denied.map(x => TOOL_NAMES[x] || x).join(", "))}</b> ma il modo o le cartelle di «${esc(it.role)}» non lo permettono.<br>`);
        const b = el("button", "btn", `Permessi di ${esc(it.role)}`); b.type = "button";
        b.onclick = () => { const m = t.members.find(x => x.role === it.role); if (m) openConvDlg(m, it.denied); };
        w.append(b); n.append(w);
      }
      const bits = [];
      if (it.tools) bits.push(`${it.tools} strumenti`);
      if (it.seconds != null) bits.push(it.seconds >= 60 ? `${Math.floor(it.seconds / 60)} min` : `${it.seconds} s`);
      const ft = el("div", "ft", esc(bits.join(" · ")) + (bits.length ? " · " : "") + "<a>dettagli</a>");
      ft.querySelector("a").onclick = () => go(conv[it.role]);
      n.append(ft); box.append(animNew(n, "t" + t.id, key));
    }
  }
  for (const m of t.members.filter(m => m.running || m.queued))
    box.append(el("div", "thinking " + color[m.role], m.running ? `<span class="dots"><i></i><i></i><i></i></span><span><span class="role">${esc(m.role)}</span> sta lavorando…</span>`
      : `<span><span class="role">${esc(m.role)}</span>: messaggio in coda (aspetta un posto libero)</span>`));
  SEEN.fresh = false;
}

/* ---------- vista Ufficio: stanza in pixel art vista in assonometria ---------- */
const READ_TOOLS = /^(Read|Glob|Grep|NotebookRead|LS)$/, EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
function deskState(m, last) {
  const a = m.activity;
  if (!m.running) {
    if (m.queued) return ["queued", `In coda: ${m.queued} messagg${m.queued > 1 ? "i" : "io"} da leggere`];
    if (last && last.denied && last.denied.length) return ["blocked", "Bloccato da un permesso: tocca per sistemare"];
    return ["idle", "In pausa"];
  }
  if (!a || a.kind === "think") return ["think", "Ragiona…"];
  if (a.kind === "write") return ["write", "Scrive: " + (a.text || "…")];
  if (a.kind === "message") return ["message", `Scrive a «${a.to}»`];
  const t = a.tool || "", s = a.text || "";
  if (READ_TOOLS.test(t)) return ["read", "Legge " + s];
  if (EDIT_TOOLS.test(t)) return ["edit", (t === "Write" ? "Scrive " : "Modifica ") + s];
  if (/^Web/.test(t)) return ["web", "Sul web: " + s];
  if (t === "TodoWrite") return ["plan", "Organizza il lavoro"];
  if (t === "Task" || t === "Agent") return ["command", "Sotto-agente: " + s];
  return ["command", "Comando: " + s];
}
const OFF = { W: 176, H: 132, ox: 88, oy: 44, raf: 0, frame: 0, last: 0, members: [], canvas: null };
const ROLE_RGB = { light: ["#1f5f8b", "#9a4f1a", "#2f7a3d", "#7a3d8f", "#a3361f", "#5d6b12"], dark: ["#7db9e8", "#eea36b", "#7fd08f", "#cf9be0", "#ec8a72", "#c8d46a"] };
const SLOTS = [[1.6, 1.4], [5.8, 1.4], [1.6, 4.6], [5.8, 4.6], [1.6, 7.8], [5.8, 7.8]];
const PAL = {
  light: { f1: "#d8c7a8", f2: "#ccb998", wl: "#ece6da", wr: "#e0d9cb", edge: "#b9ad97", dt: "#b98552", dl: "#94663c", dr: "#7d5531",
    mon: "#2a2f37", win: "#a8daf2", winb: "#ffffff", pot: "#b8683b", leaf: "#4f9a4a", leaf2: "#3d7d3a", board: "#fafaf5", frame: "#8a8f96",
    skin: "#f1c7a5", hair: "#4a3426", stool: "#5a6069", shadow: "rgba(0,0,0,.12)" },
  dark: { f1: "#3b3446", f2: "#342d3e", wl: "#2c2836", wr: "#26222f", edge: "#1c1924", dt: "#7a5436", dl: "#5f412a", dr: "#4f3622",
    mon: "#14171c", win: "#1e3553", winb: "#c9d8ef", pot: "#8a4c2b", leaf: "#3f7d3b", leaf2: "#2f612d", board: "#d9dbe0", frame: "#5b6068",
    skin: "#d9a982", hair: "#2b1f17", stool: "#3d424a", shadow: "rgba(0,0,0,.25)" },
};
const SPR_BACK = ["..hhhhh..", ".hhhhhhh.", ".hhhhhhh.", ".hhhhhhh.", "..shhhs..", "...sss...", ".bbbbbbb.", "bbbbbbbbb", "bbbbbbbbb", "dbbbbbbbd", ".bbbbbbb.", ".dd...dd."];
const isoP = (gx, gy, z = 0) => [OFF.ox + (gx - gy) * 8, OFF.oy + (gx + gy) * 4 - z];
function poly(c, pts, col) { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); }
function isoBox(c, gx, gy, w, d, h, z, top, left, right) {
  poly(c, [isoP(gx, gy + d, z), isoP(gx + w, gy + d, z), isoP(gx + w, gy + d, z + h), isoP(gx, gy + d, z + h)], left);
  poly(c, [isoP(gx + w, gy, z), isoP(gx + w, gy + d, z), isoP(gx + w, gy + d, z + h), isoP(gx + w, gy, z + h)], right);
  poly(c, [isoP(gx, gy, z + h), isoP(gx + w, gy, z + h), isoP(gx + w, gy + d, z + h), isoP(gx, gy + d, z + h)], top);
}
const px = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
function drawSprite(c, rows, x, y, pal, headDy = 0) {
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const col = pal[r[i]]; if (col) px(c, x + i, y + j + (j < 6 ? headDy : 0), 1, 1, col); } });
}
const GLYPH = { z: ["###", "..#", ".#.", "#..", "###"], "!": ["#", "#", "#", ".", "#"] };
function glyph(c, g, x, y, col) { GLYPH[g].forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "#") px(c, x + i, y + j, 1, 1, col); }); }
function drawRoom(c, P, dark) {
  const H = 38;
  poly(c, [isoP(0, 0), isoP(0, 10), isoP(0, 10, H), isoP(0, 0, H)], P.wl);            // parete sinistra
  poly(c, [isoP(0, 0), isoP(10, 0), isoP(10, 0, H), isoP(0, 0, H)], P.wr);            // parete destra
  poly(c, [isoP(0, 0, H), isoP(0, 10, H), isoP(0, 10, H + 2), isoP(0, 0, H + 2)], P.edge);
  poly(c, [isoP(0, 0, H), isoP(10, 0, H), isoP(10, 0, H + 2), isoP(0, 0, H + 2)], P.edge);
  for (let i = 0; i < 10; i++) for (let k = 0; k < 10; k++)
    poly(c, [isoP(i, k), isoP(i + 1, k), isoP(i + 1, k + 1), isoP(i, k + 1)], (i + k) % 2 ? P.f1 : P.f2);
  // finestra sulla parete destra (di sera con le stelle)
  poly(c, [isoP(3.5, 0, 14), isoP(7, 0, 14), isoP(7, 0, 31), isoP(3.5, 0, 31)], P.frame);
  poly(c, [isoP(3.7, 0, 15), isoP(6.8, 0, 15), isoP(6.8, 0, 30), isoP(3.7, 0, 30)], P.win);
  poly(c, [isoP(5.2, 0, 15), isoP(5.4, 0, 15), isoP(5.4, 0, 30), isoP(5.2, 0, 30)], P.frame);
  if (dark) [[4.3, 26], [6.2, 22], [4.8, 19]].forEach(([g, z]) => { const [x, y] = isoP(g, 0, z); px(c, x, y, 1, 1, P.winb); });
  else { const [x, y] = isoP(4.2, 0, 26); px(c, x, y, 3, 1, P.winb); px(c, x + 1, y - 1, 3, 1, P.winb); }
  // lavagna sulla parete sinistra con due scarabocchi
  poly(c, [isoP(0, 3, 13), isoP(0, 7.4, 13), isoP(0, 7.4, 30), isoP(0, 3, 30)], P.frame);
  poly(c, [isoP(0, 3.2, 14), isoP(0, 7.2, 14), isoP(0, 7.2, 29), isoP(0, 3.2, 29)], P.board);
  [["#1f5f8b", 4, 26, 12], ["#a3361f", 4.4, 22, 8], ["#2f7a3d", 4.2, 18, 14]].forEach(([col, g, z, n]) => {
    for (let i = 0; i < n; i++) { const [x, y] = isoP(0, g + i * 0.2, z); px(c, x, y, 1, 1, col); } });
  // pianta nell'angolo
  isoBox(c, 8.6, 0.5, 0.9, 0.9, 6, 0, P.pot, P.pot, P.dl);
  const [lx, ly] = isoP(9.05, 0.95, 6);
  [[-4, -4], [-2, -7], [0, -9], [2, -6], [3, -3], [-1, -3], [1, -12], [-3, -10]].forEach(([dx, dy], i) => px(c, lx + dx, ly + dy, 2, 3, i % 2 ? P.leaf : P.leaf2));
}
function screenFace(gx, gy, w, d, z, h) {
  const A = isoP(gx, gy + d, z), B = isoP(gx + w, gy + d, z), D = isoP(gx, gy + d, z + h);
  return (u, v) => [A[0] + u * (B[0] - A[0]), A[1] + u * (B[1] - A[1]) - v * (A[1] - D[1])];
}
function drawDesk(c, P, m, f) {
  const [sx, sy] = m.slot, st = m.state;
  // scrivania e monitor
  isoBox(c, sx, sy, 2.2, 0.9, 7, 0, P.dt, P.dl, P.dr);
  isoBox(c, sx + 0.5, sy + 0.05, 1.3, 0.14, 12, 7, P.mon, P.mon, P.mon);
  const sf = screenFace(sx + 0.58, sy + 0.05, 1.14, 0.14, 8, 10);
  const scr = { idle: "#151a21", queued: "#151a21", blocked: "#3a1712", think: "#2c4a66", write: "#1d2a37", edit: "#1d2a37", command: "#0b1016",
    read: "#e9e5d9", plan: "#e9e5d9", web: "#3b6ea6", message: "#2c4a66" }[st];
  poly(c, [sf(0, 0), sf(1, 0), sf(1, 1), sf(0, 1)], scr);
  const dot = (u, v, col, w = 1) => { const [x, y] = sf(u, v); px(c, x, y, w, 1, col); };
  if (st === "write" || st === "edit") for (let r = 0; r < 4; r++) { const len = ((f + r * 3) % 5) + 2; for (let i = 0; i < len; i++) dot(0.12 + i * 0.1, 0.8 - r * 0.2, r % 2 ? "#8fd19a" : "#e6edf3"); }
  if (st === "command") { dot(0.12, 0.35, "#7fd08f"); dot(0.2, 0.42, "#7fd08f"); dot(0.12, 0.49, "#7fd08f"); if (f % 2) dot(0.32, 0.3, "#7fd08f", 2); }
  if (st === "read" || st === "plan") for (let r = 0; r < 4; r++) for (let i = 0; i < 6 - (r % 2) * 2; i++) dot(0.15 + i * 0.12, 0.8 - r * 0.2, "#7b8794");
  if (st === "web") { const o = (f % 6) * 0.05; dot(0.35 + o, 0.65, "#ffffff", 3); dot(0.33 + o, 0.55, "#ffffff"); dot(0.55 + o, 0.55, "#ffffff"); dot(0.35 + o, 0.45, "#ffffff", 3); dot(0.6 + o, 0.35, "#ffffff"); }
  if (st === "think" || st === "message") if (f % 4 < 2) dot(0.45, 0.5, "#9fc4e6", 2);
  // sgabello e personaggio (di spalle, davanti al monitor)
  const cx = sx + 1.15, cy = sy + 1.7;
  isoBox(c, cx - 0.25, cy - 0.25, 0.5, 0.5, 4, 0, P.stool, P.stool, P.stool);
  const [bx, by] = isoP(cx, cy, 4);
  const x0 = bx - 4, y0 = by - 12;
  const pal = { h: P.hair, s: P.skin, b: m.rgb, d: m.rgb };
  let hd = 0;
  if (st === "idle") hd = 1;
  if (st === "think") hd = f % 8 < 4 ? 0 : -1;
  drawSprite(c, SPR_BACK, x0, y0, pal, hd);
  px(c, x0 + 1, y0 + 11, 2, 1, P.shadow); px(c, x0 + 6, y0 + 11, 2, 1, P.shadow);
  if (["write", "edit", "command", "message"].includes(st)) {   // gomiti che si alternano: digita
    const a = f % 2; px(c, x0 - 1, y0 + 8 + a, 1, 2, m.rgb); px(c, x0 + 9, y0 + 9 - a, 1, 2, m.rgb);
  }
  if (st === "read") { px(c, x0 + 8, y0 + 5, 4, 5, "#ffffff"); px(c, x0 + 9, y0 + 6, 2, 1, "#9aa5b1"); px(c, x0 + 9, y0 + 8, 2, 1, "#9aa5b1"); }
  // sopra la testa
  const hx = x0 + 4, hy = y0 - 2;
  if (st === "idle") { const k = f % 12; glyph(c, "z", hx + 3 + (k >> 2), hy - 4 - (k >> 1), dark() ? "#c9d1d9" : "#6b7785"); }
  if (st === "think") { px(c, hx - 1, hy - 9, 12, 7, "#ffffff"); px(c, hx, hy - 10, 10, 9, "#ffffff"); px(c, hx - 2, hy - 1, 2, 2, "#ffffff");
    for (let i = 0; i < 3; i++) px(c, hx + 1 + i * 3, hy - 6, 2, 2, (f >> 1) % 3 === i ? "#1f5f8b" : "#b7c3cf"); }
  if (st === "queued") { px(c, hx, hy - 9, 7, 1, "#8a5e00"); px(c, hx, hy - 1, 7, 1, "#8a5e00"); px(c, hx + 1, hy - 8, 5, 2, "#e2b04a"); px(c, hx + 2, hy - 6, 3, 2, "#e2b04a"); px(c, hx + 3, hy - 4, 1, 1, "#e2b04a"); px(c, hx + 2, hy - 3, 3, 2, f % 4 < 2 ? "#e2b04a" : "#f3d27a"); }
  if (st === "blocked" && f % 4 < 3) glyph(c, "!", hx + 2, hy - 8, "#e5484d");
  m.head = [hx + 1, hy];
}
const dark = () => document.documentElement.classList.contains("dark");
function drawOffice() {
  const cv = OFF.canvas; if (!cv) return;
  const c = cv.getContext("2d"), dk = dark(), P = PAL[dk ? "dark" : "light"], f = OFF.frame;
  c.clearRect(0, 0, OFF.W, OFF.H);
  drawRoom(c, P, dk);
  const ms = OFF.members.slice().sort((a, b) => (a.slot[0] + a.slot[1]) - (b.slot[0] + b.slot[1]));
  ms.forEach(m => drawDesk(c, P, m, f));
  // aeroplanino di carta verso il collega
  OFF.members.forEach(m => {
    if (m.state !== "message") return;
    const to = OFF.members.find(x => x.role === m.to); if (!to || !to.head || !m.head) return;
    const p = (f % 14) / 14, [x1, y1] = m.head, [x2, y2] = to.head;
    const x = x1 + (x2 - x1) * p, y = y1 + (y2 - y1) * p - Math.sin(p * Math.PI) * 14;
    px(c, x, y, 4, 1, "#ffffff"); px(c, x + 1, y - 1, 2, 1, "#ffffff"); px(c, x + 1, y + 1, 2, 1, "#c9d2db");
  });
}
function officeLoop(ts) {
  if (!OFF.canvas || !document.body.contains(OFF.canvas) || S.teamView !== "office" || !S.team) { OFF.raf = 0; return; }
  OFF.raf = requestAnimationFrame(officeLoop);
  if (document.visibilityState !== "visible" || ts - OFF.last < 125) return;   // ~8 fotogrammi al secondo, come la pixel art
  OFF.last = ts; OFF.frame++; drawOffice();
}
function placeTags() {
  const cv = OFF.canvas, room = cv && cv.parentElement; if (!room) return;
  const k = cv.clientWidth / OFF.W;
  OFF.members.forEach(m => {
    let t = room.querySelector(`.tag[data-id="${m.id}"]`);
    if (!t) { t = el("div", "tag " + m.cls); t.dataset.id = m.id; room.append(t); }
    t.textContent = m.role;
    const [sx, sy] = m.slot, [bx, by] = isoP(sx + 1.15, sy + 1.7, 4);
    t.style.left = (bx * k) + "px"; t.style.top = ((by - 24) * k) + "px";
  });
  room.querySelectorAll(".tag").forEach(t => { if (!OFF.members.some(m => m.id === t.dataset.id)) t.remove(); });
}
function renderOffice(t, color, lastWork) {
  const box = $("#msgs");
  let room = box.querySelector(".room");
  const chips = chipsEl(t, color, lastWork);
  if (!room || room.dataset.team !== t.id) {
    box.innerHTML = ""; box.append(chips, el("div", "office-head"));
    room = el("div", "room"); room.dataset.team = t.id;
    const cv = document.createElement("canvas"); cv.width = OFF.W; cv.height = OFF.H; room.append(cv);
    cv.onclick = e => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * OFF.W / r.width, y = (e.clientY - r.top) * OFF.H / r.height;
      let best = null, bd = 18;
      OFF.members.forEach(m => { if (!m.head) return; const d = Math.hypot(m.head[0] - x, m.head[1] + 8 - y); if (d < bd) { bd = d; best = m; } });
      if (best) { const mm = S.team.members.find(z => z.id === best.id); if (mm) openConvDlg(mm, best.state === "blocked" ? (lastWork[mm.role] || {}).denied : null); }
    };
    box.append(room, el("div", "staff"));
    OFF.canvas = cv;
    new ResizeObserver(placeTags).observe(cv);
  } else box.querySelector(".members").replaceWith(chips);
  const pal = dark() ? ROLE_RGB.dark : ROLE_RGB.light;
  OFF.members = t.members.slice(0, SLOTS.length).map((m, i) => {
    const [state, label] = deskState(m, lastWork[m.role]);
    const old = OFF.members.find(x => x.id === m.id);
    return { id: m.id, role: m.role, slot: SLOTS[i], cls: color[m.role], rgb: pal[i % 6], state, label,
      to: m.activity && m.activity.to, since: m.activity && m.activity.since, head: old && old.head };
  });
  const working = t.members.filter(m => m.running).length;
  box.querySelector(".office-head").textContent = working ? `${working} al lavoro · tocca un personaggio per i dettagli` : "Tutti in pausa · scrivi al team per farli lavorare";
  const staff = box.querySelector(".staff"); staff.innerHTML = "";
  OFF.members.forEach(m => {
    const since = m.since ? Math.max(0, Math.round(Date.now() / 1000 - m.since)) : null;
    const b = el("button", `${m.cls} ${m.state}`); b.type = "button";
    b.innerHTML = `<span class="pd"></span><b>${esc(m.role)}</b><span class="st">${esc(m.label)}</span><span class="tm">${since == null ? "" : since >= 60 ? Math.floor(since / 60) + " min" : since + " s"}</span>`;
    b.onclick = () => { const mm = S.team.members.find(z => z.id === m.id); if (mm) openConvDlg(mm, m.state === "blocked" ? (lastWork[mm.role] || {}).denied : null); };
    staff.append(b);
  });
  placeTags(); drawOffice();
  if (!OFF.raf) OFF.raf = requestAnimationFrame(officeLoop);
}

async function teamSend() {
  const text = $("#input").value.trim(); if (!text && !S.files.length) return;
  const files = S.files.map(f => ({ name: f.name, data: f.data }));
  $("#sendBtn").disabled = true;
  try {
    await api(`/api/teams/${S.team.id}/send`, { method: "POST", body: { to: $("#toSel").value, text, files } });
    $("#input").value = ""; autosize(); S.files = []; renderPending(); loadTeam(S.team.id);
  } catch (e) { toast(e.message); }
  finally { $("#sendBtn").disabled = false; }
}
function memberRow(m = {}) {
  const r = el("div", "mrow");
  r.innerHTML = `<input class="role-in" placeholder="nome (es. capo)" value="${esc(m.role || "")}" autocapitalize="off" autocorrect="off">
    <input class="dir-in" placeholder="sottocartella (facoltativa)" value="${esc(m.folder || "")}" autocapitalize="off" autocorrect="off">
    <button type="button" class="iconbtn x" aria-label="Togli">${ICON.err}</button>
    <select class="mode-in">${opts(MODE_LBL, m.mode || "acceptEdits")}</select><select class="model-in">${opts(MODEL_LBL, m.model || "")}</select>`;
  r.querySelector(".x").onclick = () => { if ($("#tMembers").children.length > 2) r.remove(); else toast("Servono almeno 2 membri"); };
  return r;
}
function openNewTeam() {
  closeSide(); $("#tTitle").value = ""; browse(S.tbrowse || S.browse || "", true);
  const box = $("#tMembers"); box.innerHTML = "";
  box.append(memberRow({ role: "capo" }), memberRow({ role: "sviluppo" }));
  $("#teamNewDlg").showModal();
}
async function createTeam(e) {
  if (e.submitter && e.submitter.value !== "ok") return;
  e.preventDefault();
  const members = [...$("#tMembers").children].map(r => ({ role: r.querySelector(".role-in").value, folder: r.querySelector(".dir-in").value,
    mode: r.querySelector(".mode-in").value, model: r.querySelector(".model-in").value }));
  try {
    const d = await api("/api/teams", { method: "POST", body: { title: $("#tTitle").value, folder: S.tbrowse, members } });
    $("#teamNewDlg").close(); await loadTeams(); go("t-" + d.team.id); setTimeout(() => $("#input").focus(), 50);
  } catch (err) { toast(err.message); }
}
function openTeamOpts() {
  const t = S.team; $("#tdTitle").value = t.title; $("#tdHops").value = t.max_hops;
  $("#tdInfo").textContent = `Scambi automatici finora: ${t.hops} su ${t.max_hops}. Cartella: ~/${t.folder}`;
  $("#teamDlg").showModal();
}
async function patchTeam(body) {
  try { await api(`/api/teams/${S.team.id}`, { method: "PATCH", body }); toast("Salvato"); loadTeam(S.team.id); loadTeams(); } catch (e) { toast(e.message); }
}
function initTeam() {
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $("#teamForm").addEventListener("submit", createTeam);
  $("#tAdd").onclick = () => { if ($("#tMembers").children.length < 6) $("#tMembers").append(memberRow()); else toast("Massimo 6 membri"); };
  $("#backTeam").onclick = () => go("t-" + $("#backTeam").dataset.team);
  $("#tdSave").onclick = () => patchTeam({ title: $("#tdTitle").value });
  $("#tdHopsSave").onclick = () => patchTeam({ maxHops: Number($("#tdHops").value) });
  $("#tdStop").onclick = async () => { try { await api(`/api/teams/${S.team.id}/stop`, { method: "POST", body: {} }); toast("Fermati"); $("#teamDlg").close(); loadTeam(S.team.id); } catch (e) { toast(e.message); } };
  $("#tdDelete").onclick = async () => {
    if (!confirm(`Eliminare il team «${S.team.title}» e le chat dei suoi membri? I file nelle cartelle restano.`)) return;
    try { await api(`/api/teams/${S.team.id}`, { method: "DELETE" }); $("#teamDlg").close(); S.team = null; go(""); loadTeams(); } catch (e) { toast(e.message); }
  };
}


/* ---------- impostazioni di una conversazione o di un membro del team ---------- */
const CD = { c: null, dirs: [] };
function openConvDlg(c, denied) {
  CD.c = c; CD.dirs = [...(c.dirs || [])];
  const member = !!c.team_id;
  $("#cdHead").textContent = member ? `Membro «${c.role}»` : "Conversazione";
  $("#cdTitleBox").hidden = member; $("#cdTitle").value = c.title;
  $("#cdMode").value = c.mode; $("#cdModel").value = c.model; $("#cdEffort").value = c.effort || "";
  $("#cdEffort").disabled = c.model === "haiku";
  $("#cdOwn").textContent = "~/" + c.folder;
  $("#cdDenied").hidden = !denied;
  if (denied) $("#cdDenied").innerHTML = `Era bloccato su <b>${esc(denied.map(x => TOOL_NAMES[x] || x).join(", "))}</b>. Per programmi e test scegli <b>Autonomo</b>; per file fuori dalla sua cartella aggiungi la cartella qui sotto (il percorso di solito è scritto nel suo messaggio).`;
  $("#cdRetry").hidden = !member; $("#cdOpen").hidden = !member || (S.cur && S.cur.id === c.id); $("#cdDelete").hidden = member;
  $("#cdPick").hidden = true; renderCdDirs();
  $("#convDlg").showModal();
}
function renderCdDirs() {
  const box = $("#cdDirs"); box.innerHTML = "";
  if (!CD.dirs.length) box.append(el("div", "muted small", "Nessuna."));
  CD.dirs.forEach((d, i) => {
    const r = el("div", "d", `<span>~/${esc(d)}</span><button type="button" class="iconbtn" aria-label="Togli">${ICON.err}</button>`);
    r.querySelector("button").onclick = () => { CD.dirs.splice(i, 1); renderCdDirs(); };
    box.append(r);
  });
}
async function saveConvDlg(retry) {
  const c = CD.c, body = { mode: $("#cdMode").value, model: $("#cdModel").value, effort: $("#cdEffort").value, dirs: CD.dirs };
  if (!c.team_id && $("#cdTitle").value.trim()) body.title = $("#cdTitle").value.trim();
  try {
    const d = await api(`/api/convs/${c.id}`, { method: "PATCH", body });
    if (retry) {
      const what = [`modo «${$("#cdMode").selectedOptions[0].text.split(" – ")[0]}»`].concat(CD.dirs.length ? [`cartelle in più: ${CD.dirs.map(x => "~/" + x).join(", ")}`] : []);
      await api(`/api/teams/${c.team_id}/send`, { method: "POST", body: { to: c.role, text: `Ho aggiornato i tuoi permessi (${what.join("; ")}). Riprova quello che era stato bloccato e continua il lavoro.` } });
    }
    $("#convDlg").close(); toast(retry ? `Salvato: «${c.role}» riprova` : "Salvato");
    if (S.team) loadTeam(S.team.id);
    else if (S.cur && S.cur.id === c.id) { S.cur = d.conv; $("#convTitle").textContent = d.conv.title; $("#modeSel").value = d.conv.mode; $("#modelSel").value = d.conv.model; $("#effortSel").value = d.conv.effort || ""; paintMode(); paintEffort(); loadConvs(); }
  } catch (e) { toast(e.message); }
}
function initConvDlg() {
  $("#cdModel").onchange = () => $("#cdEffort").disabled = $("#cdModel").value === "haiku";
  $("#cdAddDir").onclick = () => { $("#cdPick").hidden = false; browse(S.cbrowse || CD.c.folder || "", "c"); };
  $("#cdPickCancel").onclick = () => $("#cdPick").hidden = true;
  $("#cdPickOk").onclick = () => {
    const p = S.cbrowse || "";
    if (p === CD.c.folder) return toast("È già la sua cartella");
    if (!CD.dirs.includes(p)) CD.dirs.push(p);
    $("#cdPick").hidden = true; renderCdDirs();
  };
  $("#cdSave").onclick = () => saveConvDlg(false);
  $("#cdRetry").onclick = () => saveConvDlg(true);
  $("#cdOpen").onclick = () => { const id = CD.c.id; $("#convDlg").close(); go(id); };
  $("#cdDelete").onclick = async () => {
    if (!confirm("Eliminare questa conversazione? I file nella cartella restano.")) return;
    try { await api(`/api/convs/${CD.c.id}`, { method: "DELETE" }); $("#convDlg").close(); go(""); loadConvs(); } catch (e) { toast(e.message); }
  };
}

/* ---------- menu laterale col dito: dal bordo sinistro verso destra si apre, verso sinistra si chiude ---------- */
function initEdgeSwipe() {
  const side = $("#side"), EDGE = 28;
  let sw = null;
  const small = () => matchMedia("(max-width:860px)").matches;
  document.addEventListener("touchstart", e => {
    if (!small() || $("#app").hidden || e.touches.length !== 1) return;
    const t = e.touches[0], open = $("#app").classList.contains("open");
    if (!open && t.clientX <= EDGE) sw = { x: t.clientX, y: t.clientY, open: false, dx: 0, dir: null };
    else if (open && (e.target.closest("#side") || e.target.id === "scrim")) sw = { x: t.clientX, y: t.clientY, open: true, dx: 0, dir: null };
    else sw = null;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.dir) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      sw.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (sw.dir === "v") { sw = null; return; }
      if (!sw.open) { document.querySelectorAll("dialog[open]").forEach(d => d.close()); dropKeyboard(); }   // dalla finestra "nuovo…" si passa al menu
      side.style.transition = "none";
    }
    sw.dx = dx;
    const w = side.offsetWidth;
    const x = sw.open ? Math.min(0, dx) : Math.min(0, -w + Math.max(0, dx));
    side.style.transform = `translateX(${x}px)`;
  }, { passive: true });
  const end = () => {
    if (!sw || sw.dir !== "h") { sw = null; return; }
    const w = side.offsetWidth, d = sw.dx;
    side.style.transition = ""; side.style.transform = "";
    if (sw.open) { if (d < -w * 0.25) closeSide(); }
    else if (d > Math.min(80, w * 0.3)) openSide();
    sw = null;
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}

/* Haiku non ha i livelli di effort: il menu si disattiva */
function paintEffort() { $("#effortSel").disabled = $("#modelSel").value === "haiku"; }

/* ---------- impostazioni ---------- */
async function openSettings() {
  closeSide();
  $("#setDlg").showModal();
  try {
    const s = await api("/api/settings");
    const st = $("#claudeStatus");
    st.classList.toggle("bad", !s.claudeInstalled);
    st.innerHTML = !s.claudeInstalled ? "Claude Code non trovato sul NAS (manca <code>~/.local/bin/claude</code>)."
      : s.tokenSaved ? `Claude Code pronto con il tuo abbonamento. Token valido fino al <b>${esc(s.tokenExpires || "?")}</b> circa.`
      : "Claude Code installato. Nessun token salvato qui: userà il login di Claude Code sul NAS, se c'è.";
    $("#notesIn").value = s.notes;
  } catch (e) { $("#claudeStatus").textContent = e.message; }
  loadUpdate(false);
  renderThemes();
}
async function saveToken() {
  try { await api("/api/settings", { method: "POST", body: { token: $("#tokenIn").value } }); $("#tokenIn").value = ""; toast("Token salvato"); openSettings(); }
  catch (e) { toast(e.message); }
}
async function testClaude() {
  const b = $("#testBtn"); b.disabled = true; b.textContent = "Provo…";
  try { const r = await api("/api/settings/test", { method: "POST", body: {} }); toast(r.ok ? "Funziona: " + r.message : r.message, !r.ok); }
  catch (e) { toast(e.message, true); }
  finally { b.disabled = false; b.textContent = "Prova collegamento"; }
}
async function saveNotes() {
  try { await api("/api/settings", { method: "POST", body: { notes: $("#notesIn").value } }); toast("Istruzioni salvate"); } catch (e) { toast(e.message); }
}

/* ---------- aggiornamenti (da GitHub) ---------- */
let updPoll = 0;
function paintUpdate(s) {
  const st = $("#updStatus"), go = $("#updGo");
  const cur = s.installed.label + (s.installed.message ? ` – ${esc(s.installed.message)}` : "");
  st.classList.toggle("bad", !!(s.error || s.failed));
  st.innerHTML = s.running ? "Aggiornamento in corso…"
    : s.failed ? `L'ultimo aggiornamento non è riuscito: ${esc(s.failed)}`
    : s.error ? `${esc(s.error)}<br>Installata: ${cur}`
    : s.available ? `Nuova versione: <b>${esc(s.latest.message)}</b> (${esc(s.latest.sha.slice(0, 7))})<br>Installata: ${cur}`
      + (s.busy && s.busy.length ? `<br><b>Bloccato finché lavora:</b> ${esc(s.busy.join(", "))}. Si sblocca da solo quando hanno finito.` : "")
    : s.latest ? `Cantiere è aggiornato. Versione: ${cur}` : `Versione installata: ${cur}`;
  const busy = !!(s.busy && s.busy.length);
  go.hidden = !s.available || s.running;
  go.disabled = busy;
  $("#updTop").hidden = !s.available;
  $("#updTop").disabled = !!s.running || busy;
  $("#updTopLbl").textContent = busy ? `Aggiorna · ${s.busy.length} al lavoro` : "Aggiorna";
  $("#updTop").title = busy ? "Bloccato finché lavora: " + s.busy.join(", ") : "";
  /* c'è una versione nuova: ricontrollo spesso chi lavora, così il pulsante si sblocca da solo */
  clearTimeout(updPoll);
  if (s.available && !s.running) updPoll = setTimeout(() => document.visibilityState === "visible" && notifyUpdate(), busy ? 5000 : 30000);
  $("#verLine").textContent = `Versione ${s.version || "?"} · ${s.installed.label}`;
}
async function loadUpdate(check) {
  try { paintUpdate(await api(check ? "/api/update/check" : "/api/update", check ? { method: "POST", body: {} } : {})); }
  catch (e) { $("#updStatus").textContent = e.message; }
}
async function runUpdate() {
  if (!confirm("Aggiornare Cantiere adesso? Il server si riavvia: le risposte in corso si interrompono.")) return;
  const go = $("#updGo"), before = (await api("/api/update")).installed.sha;
  go.disabled = true; $("#updTop").disabled = true;
  try { await api("/api/update/run", { method: "POST", body: {} }); } catch (e) { if (!/già in corso/.test(e.message)) { toast(e.message, true); go.disabled = false; $("#updTop").disabled = false; return; } }
  /* barra: ogni fase ha un tratto; dentro la fase avanza piano da sola finché il NAS non passa alla successiva */
  const STEPS = [[0, 15, "Avvio…"], [15, 40, "Copia del database…"], [40, 70, "Scarico la nuova versione da GitHub…"], [70, 95, "Riavvio del server…"]];
  let step = 0, pct = 0, down = false;
  document.querySelectorAll("dialog[open]").forEach(d => d.close());   // le finestre stanno sopra a tutto: chiudo, se no la barra resta dietro
  $("#updOverlay").hidden = false;
  const paint = () => {
    const [a, b, txt] = STEPS[step];
    pct = Math.max(pct, a); pct += (b - pct) * 0.08;
    $("#updBar").style.width = pct + "%";
    $("#updStep").textContent = down ? "Riavvio del server… (il NAS torna tra pochi secondi)" : txt;
  };
  const tick = setInterval(paint, 500); paint();
  const end = (msg, bad) => { clearInterval(tick); $("#updOverlay").hidden = true; toast(msg, bad); go.disabled = false; $("#updTop").disabled = false; };
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    let s; try { s = await api("/api/update"); down = false; } catch { down = true; step = 3; continue; }   // durante il riavvio il NAS non risponde
    if (s.failed) { end("Aggiornamento non riuscito: " + s.failed, true); return paintUpdate(s); }
    if (s.running && s.step != null) step = Math.max(step, s.step);
    if (!s.running && s.installed.sha !== before) {
      clearInterval(tick); $("#updBar").style.width = "100%"; $("#updStep").textContent = `Fatto: versione ${s.version || ""}. Ricarico l'app…`;
      setTimeout(() => location.reload(), 1200); return;
    }
  }
  end("Il NAS non ha ancora finito: riapri l'app tra poco", true);
}
async function notifyUpdate() {
  try {
    const s = await api("/api/update");
    paintUpdate(s);
  } catch {}
}

/* ---------- login ---------- */
function showLogin() { closeStream(); $("#app").hidden = true; $("#login").hidden = false; setTimeout(() => $("#pw").focus(), 50); }
async function login(e) {
  e.preventDefault(); $("#loginErr").textContent = "";
  try { await api("/api/login", { method: "POST", body: { password: $("#pw").value } }); $("#pw").value = ""; start(); }
  catch (err) { $("#loginErr").textContent = err.message; }
}
async function logout() { try { await api("/api/logout", { method: "POST", body: {} }); } catch {} $("#setDlg").close(); showLogin(); }

/* ---------- varie ---------- */
function toast(msg, bad) {
  const t = el("div", "", esc(msg));
  Object.assign(t.style, { position: "fixed", left: "50%", bottom: "calc(90px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 99,
    background: bad ? "var(--bad)" : "var(--fg)", color: "var(--bg)", padding: "9px 14px", borderRadius: "8px", fontSize: ".9rem", maxWidth: "min(90vw,480px)", boxShadow: "0 4px 18px rgba(0,0,0,.2)" });
  document.body.append(t); setTimeout(() => t.remove(), 4000);
}
const closeSide = () => $("#app").classList.remove("open");
/* con la tastiera aperta iOS sposta in su tutta la pagina: il menu si apriva già scorso (si vedeva solo il fondo) */
function dropKeyboard() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
  window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
}
function openSide() { dropKeyboard(); $("#app").classList.add("open"); }

async function start() {
  $("#login").hidden = true; $("#app").hidden = false;
  try { await loadConvs(); } catch { return; }
  if (!S.listLoop) { S.listLoop = true; listLoop(); }
  route();
  notifyUpdate();
}

function init() {
  $("#loginForm").onsubmit = login;
  $("#composer").onsubmit = send;
  /* con la tastiera aperta il primo tocco chiudeva solo la tastiera (la casella si abbassava e il pulsante
     scappava da sotto il dito): invio già al rilascio del dito, senza togliere il fuoco alla casella */
  $("#sendBtn").addEventListener("touchend", e => {
    const t = e.changedTouches[0], r = $("#sendBtn").getBoundingClientRect();
    if (t.clientX < r.left - 10 || t.clientX > r.right + 10 || t.clientY < r.top - 10 || t.clientY > r.bottom + 10) return;
    e.preventDefault();
    if (!$("#sendBtn").disabled) $("#composer").requestSubmit();
  }, { passive: false });
  $("#input").addEventListener("input", autosize);
  $("#input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !touch && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
  });
  $("#attachBtn").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  $("#input").addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  $("#modeSel").onchange = () => { paintMode(); patchConv({ mode: $("#modeSel").value }); };
  $("#modelSel").onchange = () => { localStorage.setItem("cantiere-model", $("#modelSel").value); paintEffort(); patchConv({ model: $("#modelSel").value }); };
  $("#effortSel").onchange = () => { localStorage.setItem("cantiere-effort", $("#effortSel").value); patchConv({ effort: $("#effortSel").value }); };
  $("#moreBtn").onclick = more;
  $("#convTitle").onclick = () => S.cur && more();
  $("#newBtn").onclick = openNew;
  $("#mkdirBtn").onclick = mkdir;
  $("#newDir").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); mkdir(); } });
  $("#newForm").addEventListener("submit", createConv);
  $("#settingsBtn").onclick = openSettings;
  initTeam(); renderTabs();
  $("#sbSel").onchange = () => { localStorage.setItem("cantiere-statusbar", $("#sbSel").value); toast("iOS la cambia solo riaggiungendo l'app alla Home: vedi la spiegazione qui sopra"); };
  $("#schemeSel").onchange = () => { localStorage.setItem("cantiere-scheme", $("#schemeSel").value); applyTheme(); renderThemes(); };
  initEdgeSwipe(); initConvDlg();
  $("#tokenSave").onclick = saveToken;
  $("#testBtn").onclick = testClaude;
  $("#notesSave").onclick = saveNotes;
  $("#updCheck").onclick = () => loadUpdate(true);
  $("#updGo").onclick = runUpdate;
  $("#updTop").onclick = runUpdate;
  /* spazio lasciato all'intestazione fissa (cambia con la barra di stato e la rotazione) */
  new ResizeObserver(() => document.documentElement.style.setProperty("--toph", $(".top").offsetHeight + "px")).observe($(".top"));
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--compoh", ($("#composer").hidden ? 0 : $("#composer").offsetHeight) + "px");
    if (STICK.on) requestAnimationFrame(toBottom);
  }).observe($("#composer"));
  initStick();
  /* tastiera aperta: tolgo lo spazio per la barra home sotto la casella */
  $("#input").addEventListener("focus", () => document.body.classList.add("kb"));
  $("#input").addEventListener("blur", () => document.body.classList.remove("kb"));
  /* trascinando la chat verso il basso si abbassa la tastiera (come in Messaggi) */
  let y0 = null;
  const down = e => { y0 = e.touches.length === 1 ? e.touches[0].clientY : null; };
  const move = e => {
    if (y0 == null || document.activeElement !== $("#input")) return;
    if (e.target === $("#input") && $("#input").scrollHeight > $("#input").clientHeight) return;   // scorre il testo
    if (e.touches[0].clientY - y0 > 40) { $("#input").blur(); y0 = null; }
  };
  for (const n of [$("#scroller"), $("#composer")]) {
    n.addEventListener("touchstart", down, { passive: true });
    n.addEventListener("touchmove", move, { passive: true });
  }
  $("#logoutBtn").onclick = logout;
  $("#menuBtn").onclick = openSide;
  $("#scrim").onclick = closeSide;
  $("#msgs").addEventListener("click", e => {
    const b = e.target.closest(".copy"); if (!b) return;
    const txt = b.closest(".code").querySelector("code").textContent;
    const done = () => { b.textContent = "Copiato"; setTimeout(() => b.textContent = "Copia", 1500); };
    if (navigator.clipboard && isSecureContext) navigator.clipboard.writeText(txt).then(done, () => toast("Copia non riuscita"));
    else { const t = el("textarea"); t.value = txt; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); done(); }
  });
  addEventListener("hashchange", route);
  /* tornando sull'app (iPhone la sospende in background) ricarico lo stato */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ping(true);
    if (document.visibilityState !== "visible" || $("#app").hidden) return;
    loadConvs().catch(() => {});
    notifyUpdate();
    if (S.team) loadTeam(S.team.id, true);
    if (S.cur) { closeStream(); S.live = null; loadConv(S.cur.id, true); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  /* all'apertura: se il NAS non risponde mostro l'avviso e riprovo da solo; appena torna, entro */
  const boot = async () => {
    const s = await ping(true);
    if (!s) { NET.onBack = boot; showLogin(); $("#loginErr").textContent = "In attesa del NAS: entro da solo appena risponde."; return; }
    if (!s.configured) { showLogin(); $("#loginErr").textContent = "Password non ancora impostata: sul NAS lancia python3 imposta-password.py"; }
    else if (s.logged) start(); else showLogin();
  };
  boot();
}
init();
