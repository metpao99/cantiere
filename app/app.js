"use strict";
/* Cantiere – interfaccia della chat con Claude Code sul NAS */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const touch = matchMedia("(pointer:coarse)").matches;

const S = { convs: [], cur: null, msgs: [], live: null, es: null, files: [], browse: "" };

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
    box.append(el("div", "empty", `<h2>Ciao!</h2><p>Apri una conversazione: scegli una cartella del NAS e Claude ci lavora dentro con te.</p><button class="btn" id="emptyNew">Nuova conversazione</button>`));
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
function renderList() {
  const nav = $("#convList"); nav.innerHTML = "";
  if (!S.convs.length) { const p = el("p", "muted small", "Nessuna conversazione."); p.style.padding = "4px 10px"; nav.append(p); }
  for (const c of S.convs) {
    const b = el("button", "conv");
    b.setAttribute("aria-current", S.cur && S.cur.id === c.id ? "true" : "false");
    b.innerHTML = `<div class="t">${c.running ? '<span class="dot" title="Al lavoro"></span>' : ""}<span>${esc(c.title)}</span></div><div class="s">${esc(c.folder || "~")} · ${ago(c.updated)}</div>`;
    b.onclick = () => { location.hash = c.id; closeSide(); };
    nav.append(b);
  }
}
async function loadConvs() { S.convs = (await api("/api/convs")).convs; renderList(); }
async function loadConv(id, keepScroll) {
  try {
    const d = await api(`/api/convs/${id}`);
    if (location.hash.slice(1) !== id) return;
    S.cur = d.conv; S.msgs = d.msgs;
    $("#convTitle").textContent = d.conv.title; $("#convFolder").textContent = "~/" + d.conv.folder;
    $("#moreBtn").hidden = false; $("#composer").hidden = false;
    $("#modeSel").value = d.conv.mode; $("#modelSel").value = d.conv.model; $("#effortSel").value = d.conv.effort || ""; paintEffort(); paintMode();
    if (d.conv.running) { if (!S.es) openStream(id); else S.live = S.live || { blocks: [] }; }
    else { closeStream(); S.live = null; setBusy(false); }
    renderMsgs(); renderList();
  } catch (e) { toast(e.message); location.hash = ""; }
}
function route() {
  const id = location.hash.slice(1);
  closeStream(); S.live = null; setBusy(false);
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
  const a = prompt("Rinomina la conversazione (lascia vuoto per eliminarla):", S.cur.title);
  if (a === null) return;
  if (a.trim()) return patchConv({ title: a.trim() });
  if (!confirm("Eliminare questa conversazione? I file nella cartella restano.")) return;
  await api(`/api/convs/${S.cur.id}`, { method: "DELETE" });
  location.hash = ""; loadConvs();
}

/* ---------- nuova conversazione: scelta della cartella ---------- */
async function browse(path) {
  try {
    const d = await api("/api/folders?path=" + encodeURIComponent(path));
    S.browse = d.path;
    $("#crumb").textContent = d.root + (d.path ? "/" + d.path : "") + "/";
    const box = $("#dirs"); box.innerHTML = "";
    if (d.parent !== null) { const up = el("button", "", ICON.up + "<span>Cartella superiore</span>"); up.type = "button"; up.onclick = () => browse(d.parent); box.append(up); }
    d.dirs.forEach(n => { const b = el("button", "", ICON.folder + `<span>${esc(n)}</span>`); b.type = "button"; b.onclick = () => browse((d.path ? d.path + "/" : "") + n); box.append(b); });
    if (!d.dirs.length) { const p = el("p", "muted small", "Nessuna sottocartella."); p.style.padding = "4px 12px"; box.append(p); }
  } catch (e) { toast(e.message); }
}
function openNew() { closeSide(); $("#newDir").value = ""; browse(S.browse || ""); $("#newDlg").showModal(); }
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
    $("#newDlg").close(); await loadConvs(); location.hash = d.conv.id; setTimeout(() => $("#input").focus(), 50);
  } catch (err) { toast(err.message); }
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
function paintUpdate(s) {
  const st = $("#updStatus"), go = $("#updGo");
  const cur = s.installed.label + (s.installed.message ? ` – ${esc(s.installed.message)}` : "");
  st.classList.toggle("bad", !!(s.error || s.failed));
  st.innerHTML = s.running ? "Aggiornamento in corso…"
    : s.failed ? `L'ultimo aggiornamento non è riuscito: ${esc(s.failed)}`
    : s.error ? `${esc(s.error)}<br>Installata: ${cur}`
    : s.available ? `Nuova versione: <b>${esc(s.latest.message)}</b> (${esc(s.latest.sha.slice(0, 7))})<br>Installata: ${cur}`
    : s.latest ? `Cantiere è aggiornato. Versione: ${cur}` : `Versione installata: ${cur}`;
  go.hidden = !s.available || s.running;
  go.disabled = false;
  $("#updTop").hidden = !s.available;
  $("#updTop").disabled = !!s.running;
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
  $("#tokenSave").onclick = saveToken;
  $("#testBtn").onclick = testClaude;
  $("#notesSave").onclick = saveNotes;
  $("#updCheck").onclick = () => loadUpdate(true);
  $("#updGo").onclick = runUpdate;
  $("#updTop").onclick = runUpdate;
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
    if (S.cur) { closeStream(); S.live = null; loadConv(S.cur.id, true); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  fetch("/api/state", { credentials: "same-origin" }).then(r => r.json()).then(s => {
    if (!s.configured) { showLogin(); $("#loginErr").textContent = "Password non ancora impostata: sul NAS lancia python3 imposta-password.py"; }
    else if (s.logged) start(); else showLogin();
  }).catch(() => { showLogin(); $("#loginErr").textContent = "NAS non raggiungibile"; });
}
init();
