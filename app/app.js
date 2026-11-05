"use strict";
/* Cantiere – interfaccia della chat con Claude Code sul NAS */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const touch = matchMedia("(pointer:coarse)").matches;

const S = { convs: [], cur: null, msgs: [], live: null, es: null, files: [], browse: "", tbrowse: "",
  tab: localStorage.getItem("cantiere-tab") || "chat", teams: [], team: null, poll: 0 };

async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
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
      out.push(`<div class="code"><div class="codebar"><span>${esc(fence[1])}</span><button type="button" class="copy">Copia</button></div><pre><code>${esc(buf.join("\n"))}</code></pre></div>`);
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
function nearBottom() { const s = $("#scroller"); return s.scrollHeight - s.scrollTop - s.clientHeight < 120; }
function toBottom() { const s = $("#scroller"); s.scrollTop = s.scrollHeight; }

function renderMsgs() {
  const box = $("#msgs"); box.innerHTML = "";
  if (!S.cur) {
    box.append(el("div", "empty", S.tab === "team"
      ? `<h2>Team</h2><p>Più sessioni di Claude, ognuna nella sua cartella, che si passano il lavoro. Tu scrivi al capo e segui lo scambio.</p><button class="btn" id="emptyNew">Nuovo team</button>`
      : `<h2>Ciao!</h2><p>Apri una conversazione: scegli una cartella del NAS e Claude ci lavora dentro con te.</p><button class="btn" id="emptyNew">Nuova conversazione</button>`));
    $("#emptyNew").onclick = openNew; return;
  }
  if (!S.msgs.length && !S.live) box.append(el("div", "empty", `<p>Claude lavora in <code>${esc(S.cur.folder || "~")}</code>. Chiedigli cosa vuoi costruire.</p>`));
  S.msgs.forEach(m => box.append(msgEl(m)));
  if (S.live) { S.live.node = el("div", "msg bot"); box.append(S.live.node); drawLive(); }
  toBottom();
}
let raf = 0;
function drawLive() {
  if (!S.live || !S.live.node) return;
  const stick = nearBottom();
  const n = S.live.node; n.innerHTML = "";
  const box = el("div"); botBlocks(box, S.live.blocks); n.append(box);
  const last = S.live.blocks[S.live.blocks.length - 1];
  if (!last || last.type !== "text" || !last.text) n.append(el("div", "thinking", '<span class="spin"></span>Claude sta lavorando…'));
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
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { S.es = null; setTimeout(() => S.cur && S.cur.id === id && loadConv(id, true), 2000); } };
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
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === S.tab ? "true" : "false"));
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
async function loadConvs() { S.convs = (await api("/api/convs")).convs; renderList(); if (S.tab === "team") loadTeams().catch(() => {}); }
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
function go(h) { history.replaceState(null, "", h ? "#" + h : location.pathname + location.search); route(); }
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
  loadConv(id);
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
  $("#toSel").hidden = !team; $("#attachBtn").hidden = team;
  ["#modeSel", "#modelSel", "#effortSel"].forEach(s => $(s).hidden = team);
  $("#input").placeholder = team ? "Scrivi al team…" : "";
}
async function loadTeams() { S.teams = (await api("/api/teams")).teams; if (S.tab === "team") renderTeamList(); }
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
  if (changed) { renderTeam(); if (stick) toBottom(); }
  renderTeamList();
  S.poll = setTimeout(() => loadTeam(id, true), t.running ? 2500 : 15000);
}
function renderTeam() {
  const t = S.team, box = $("#msgs");
  const oldChips = box.querySelector(".members"), keepX = oldChips && oldChips.dataset.team === t.id ? oldChips.scrollLeft : 0;
  box.innerHTML = "";
  const color = {}; t.members.forEach((m, i) => color[m.role] = "c" + (i % 6));
  const chips = el("div", "members");
  const lastWork = {}; t.timeline.forEach(it => { if (it.kind === "work") lastWork[it.role] = it; });
  t.members.forEach(m => {
    const c = el("button", "chip " + color[m.role]); c.type = "button";
    c.innerHTML = `${m.running ? '<span class="spin"></span>' : ""}<b>${esc(m.role)}</b>${!m.running && lastWork[m.role] && lastWork[m.role].denied ? '<span class="warn" title="Bloccato da un permesso">!</span>' : ""}<span class="q">${esc(MODE_LBL[m.mode] || "")}${m.model ? " · " + esc(MODEL_LBL[m.model]) : ""}${m.queued ? ` · ${m.queued} in coda` : ""}</span>`;
    c.title = "Impostazioni di " + m.role; c.onclick = () => openConvDlg(m);
    chips.append(c);
  });
  chips.dataset.team = t.id;
  box.append(chips); chips.scrollLeft = keepX;   // il ridisegno automatico non deve riportare la riga all'inizio
  if (!t.timeline.length) box.append(el("div", "empty", `<p>Scrivi al team: il messaggio va a <b>${esc(t.members[0].role)}</b> (o a chi scegli in basso). I membri si passano il lavoro da soli e tu vedi qui tutto lo scambio. Tocca un membro per aprire la sua chat completa.</p>`));
  const conv = {}; t.members.forEach(m => conv[m.role] = m.id);
  for (const it of t.timeline) {
    if (it.kind === "msg") {
      const me = it.from === "tu", n = el("div", "tl-msg " + (me ? "me" : color[it.from] || "c0"));
      n.innerHTML = `<div class="hd">${me ? "Tu" : `<span class="role ${color[it.from]}">${esc(it.from)}</span>`} → <span class="role ${color[it.role]}">${esc(it.role)}</span></div>`;
      n.append(document.createTextNode(it.text));
      box.append(n);
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
      n.append(ft); box.append(n);
    }
  }
  for (const m of t.members.filter(m => m.running || m.queued))
    box.append(el("div", "thinking " + color[m.role], m.running ? `<span class="spin"></span><span><span class="role">${esc(m.role)}</span> sta lavorando…</span>`
      : `<span><span class="role">${esc(m.role)}</span>: messaggio in coda (aspetta un posto libero)</span>`));
}
async function teamSend() {
  const text = $("#input").value.trim(); if (!text) return;
  $("#sendBtn").disabled = true;
  try {
    await api(`/api/teams/${S.team.id}/send`, { method: "POST", body: { to: $("#toSel").value, text } });
    $("#input").value = ""; autosize(); loadTeam(S.team.id);
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
      if (!sw.open) document.querySelectorAll("dialog[open]").forEach(d => d.close());   // dalla finestra "nuovo…" si passa al menu
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
    else if (d > Math.min(80, w * 0.3)) $("#app").classList.add("open");
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

async function start() {
  $("#login").hidden = true; $("#app").hidden = false;
  try { await loadConvs(); } catch { return; }
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
  $("#menuBtn").onclick = () => $("#app").classList.add("open");
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
    if (document.visibilityState !== "visible" || $("#app").hidden) return;
    loadConvs().catch(() => {});
    notifyUpdate();
    if (S.team) loadTeam(S.team.id, true);
    if (S.cur) { closeStream(); S.live = null; loadConv(S.cur.id, true); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  fetch("/api/state", { credentials: "same-origin" }).then(r => r.json()).then(s => {
    if (!s.configured) { showLogin(); $("#loginErr").textContent = "Password non ancora impostata: sul NAS lancia python3 imposta-password.py"; }
    else if (s.logged) start(); else showLogin();
  }).catch(() => { showLogin(); $("#loginErr").textContent = "NAS non raggiungibile"; });
}
init();
