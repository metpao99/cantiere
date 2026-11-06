#!/usr/bin/env python3
"""
Cantiere – chat con Claude Code installato sul NAS (solo libreria standard Python 3.9+).

Avvio:     python3 server.py --port 8766 [--root /home/Mattia]
Password:  python3 imposta-password.py   (obbligatoria: l'app può eseguire comandi sul NAS)
Dati:      cantiere.db (SQLite) nella stessa cartella.

Ogni conversazione lavora in una cartella sotto --root (di default la tua home).
Ogni messaggio avvia `claude -p` in quella cartella; i messaggi successivi riprendono
la stessa sessione di Claude Code con --resume, quindi Claude ricorda la conversazione.

API (tutte richiedono il login, tranne /api/state e /api/login)
  GET    /api/state                      {configured, logged}
  POST   /api/login | /api/logout
  GET    /api/settings                   stato di Claude Code e del token, istruzioni
  POST   /api/settings                   {token?, notes?}
  POST   /api/settings/test              prova il collegamento a Claude
  GET    /api/folders?path=rel           sottocartelle (non nascoste) sotto --root
  POST   /api/folders                    {path, name} crea una cartella
  GET    /api/convs                      elenco conversazioni
  POST   /api/convs                      {folder, model, mode, effort} nuova conversazione
  GET    /api/convs/<id>                 conversazione + messaggi + stato
  PATCH  /api/convs/<id>                 {title?, model?, mode?, effort?, dirs?:[cartelle in più sotto --root]}
  DELETE /api/convs/<id>                 elimina la conversazione (i file restano)
  POST   /api/convs/<id>/send            {text, files:[{name, data(base64)}]}
  GET    /api/update                     versione installata e ultima su GitHub (controllo ogni 10 minuti)
  POST   /api/update/check               controlla subito GitHub
  POST   /api/update/run                 avvia update.py: copia del database, aggiornamento, riavvio
  POST   /api/convs/<id>/stop            ferma la risposta in corso
  GET    /api/convs/<id>/events          flusso (text/event-stream) della risposta in corso
  GET    /api/teams                      elenco dei team
  POST   /api/teams                      {title, folder, members:[{role, folder, mode, model}]} nuovo team
  GET    /api/teams/<id>                 team, membri (stato e coda) e cronologia unica dei messaggi
  PATCH  /api/teams/<id>                 {title?, maxHops?}
  DELETE /api/teams/<id>                 elimina il team e le chat dei membri (i file restano)
  POST   /api/teams/<id>/send            {to, text} messaggio dell'utente a un membro (azzera il contatore)
  POST   /api/teams/<id>/stop            ferma tutti i membri e svuota la coda
Per i membri dei team (solo con la chiave X-Cantiere-Key che il server dà a ogni risposta in corso):
  GET    /api/agent/team                 chi sono e chi c'è nel team
  POST   /api/agent/send                 {to, text} messaggio a un altro membro (vedi team.py)
Tutto il resto viene servito dalla cartella ./app
"""
import argparse, base64, datetime, hashlib, hmac, json, mimetypes, os, re, secrets, shutil, signal
import sqlite3, subprocess, sys, threading, time, urllib.error, uuid
import update as updater   # lo stesso script che si usa dal terminale (python3 update.py)
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

APP_VERSION = "2.1"   # aumentalo a ogni modifica pubblicata (si vede in Impostazioni)
BASE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE, "app")
DB_PATH = os.path.join(BASE, "cantiere.db")
AUTH_FILE = os.path.join(BASE, "auth.json")
TOKEN_FILE = os.path.join(BASE, "claude-token.json")
NOTES_FILE = os.path.join(BASE, "istruzioni.md")
COOKIE = "cantiere_session"
SESSION_AGE = 90 * 24 * 3600
ID_RE = re.compile(r"^[a-f0-9]{12}$")
MODES = ("plan", "acceptEdits", "bypassPermissions")
MODELS = ("", "opus", "sonnet", "haiku")
EFFORTS = ("", "low", "medium", "high", "xhigh", "max")   # "" = predefinito di Claude Code
MAX_RUNS = int(os.environ.get("CANTIERE_MAX_RUNS", "2"))   # 4 GB di RAM: meglio non esagerare
RUN_TIMEOUT = 45 * 60
ROOT = os.path.expanduser("~")

DEFAULT_NOTES = """Stai lavorando su un NAS UGREEN NASync DH2300 (UGOS Pro, base Debian 12, ARM64, 4 GB di RAM).
- C'è Python 3.11 (solo libreria standard: niente pip se non chiesto). Docker NON è disponibile.
- Non usare apt né sudo e non modificare il sistema: lavora solo nelle cartelle dell'utente.
- `cron` è vietato agli utenti normali: per l'avvio automatico spiega la riga da aggiungere a `sudo crontab -e` (@reboot) e lascia che la aggiunga io.
- Il NAS si spegne ogni sera alle 23:00.
- Non fermare né riavviare il server di questa chat (cartella cantiere-server, porta 8766): interromperesti questa conversazione.
- Ti scrivo dal telefono: rispondi in italiano, conciso; per i comandi da far girare a me evita `--` e `&&` (il copia-incolla li altera).
"""

_lock = threading.RLock()
_conn = None
RUNS = {}            # conv_id -> Run
AGENT_KEYS = {}      # chiave segreta della risposta in corso -> conv_id (per team.py)
PORT = 8766
TEAM_PY = os.path.join(BASE, "team.py")
MAX_HOPS = 8         # scambi automatici tra membri prima di tornare all'utente
_login_fail = {"n": 0, "until": 0.0}


# ---------- database ----------
def db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created INTEGER, last_seen INTEGER);
            CREATE TABLE IF NOT EXISTS convs (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, folder TEXT NOT NULL, claude_sid TEXT,
                model TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'acceptEdits',
                created INTEGER NOT NULL, updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS msgs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, role TEXT NOT NULL,
                blocks TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS msgs_conv ON msgs(conv_id, id);
        """)
        cols = [r[1] for r in _conn.execute("PRAGMA table_info(convs)")]
        for col, default in (("effort", "''"), ("team_id", "''"), ("role", "''"), ("dirs", "'[]'")):
            if col not in cols:
                _conn.execute(f"ALTER TABLE convs ADD COLUMN {col} TEXT NOT NULL DEFAULT {default}")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '',
                hops INTEGER NOT NULL DEFAULT 0, max_hops INTEGER NOT NULL DEFAULT 8,
                created INTEGER NOT NULL, updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS inbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, from_role TEXT NOT NULL,
                text TEXT NOT NULL, created INTEGER NOT NULL);
        """)
        _conn.commit()
    return _conn


def q(sql, args=(), one=False):
    with _lock:
        cur = db().execute(sql, args)
        rows = cur.fetchall()
        db().commit()
    rows = [dict(r) for r in rows]
    return (rows[0] if rows else None) if one else rows


# ---------- password ----------
def hash_password(pw, salt=None, it=200_000):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), it).hex()
    return {"salt": salt, "hash": h, "iter": it}


def check_password(pw):
    try:
        with open(AUTH_FILE) as f:
            a = json.load(f)
    except (OSError, ValueError):
        return False
    return hmac.compare_digest(hash_password(pw, a["salt"], a["iter"])["hash"], a["hash"])


def save_secret(path, text):
    with open(path, "w") as f:
        f.write(text)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# ---------- Claude Code ----------
def claude_bin():
    p = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
    return p if os.path.isfile(p) and os.access(p, os.X_OK) else None


def claude_token():
    try:
        with open(TOKEN_FILE) as f:
            d = json.load(f)
        return d if d.get("token") else None
    except (OSError, ValueError):
        return None


def claude_env():
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    tok = claude_token()
    if tok:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = tok["token"]
    local_bin = os.path.expanduser("~/.local/bin")
    if local_bin not in env.get("PATH", "").split(":"):
        env["PATH"] = local_bin + ":" + env.get("PATH", "/usr/bin:/bin")
    return env


def notes():
    try:
        with open(NOTES_FILE, encoding="utf-8") as f:
            return f.read()
    except OSError:
        with open(NOTES_FILE, "w", encoding="utf-8") as f:
            f.write(DEFAULT_NOTES)
        return DEFAULT_NOTES


def explain_error(text):
    t = (text or "").lower()
    if any(w in t for w in ("expired", "401", "invalid api key", "unauthorized", "not logged", "oauth", "/login")):
        return "Collegamento a Claude scaduto o non valido: incolla un nuovo token in Impostazioni."
    if "rate limit" in t or "usage limit" in t or "limit reached" in t:
        return "Limite d'uso dell'abbonamento raggiunto: riprova più tardi."
    if "no conversation found" in t:
        return "Claude non trova più questa sessione (cartella spostata?): apri una nuova conversazione."
    return (text or "Errore sconosciuto").strip()[-400:]


# ---------- cartelle ----------
def safe_dir(rel):
    rel = (rel or "").strip().strip("/")
    full = os.path.realpath(os.path.join(ROOT, rel))
    root = os.path.realpath(ROOT)
    if full != root and not full.startswith(root + os.sep):
        raise ValueError("Cartella fuori dalla zona permessa")
    return full


def rel_of(full):
    r = os.path.relpath(full, os.path.realpath(ROOT))
    return "" if r == "." else r


def clean_filename(name):
    name = os.path.basename(str(name or "file")).strip()
    name = re.sub(r"[^\w.\- ]+", "_", name)[:80].strip(". ") or "file"
    return name


# ---------- esecuzione di una risposta ----------
def summarize_tool(name, inp, cwd):
    inp = inp if isinstance(inp, dict) else {}
    def short_path(p):
        p = str(p or "")
        return os.path.relpath(p, cwd) if p.startswith(cwd + os.sep) else p
    if name == "Bash":
        return str(inp.get("description") or inp.get("command") or "")[:200], str(inp.get("command") or "")[:4000]
    if name in ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit"):
        detail = ""
        if name == "Edit":
            detail = "− " + str(inp.get("old_string", ""))[:1500] + "\n+ " + str(inp.get("new_string", ""))[:1500]
        elif name == "Write":
            detail = str(inp.get("content", ""))[:3000]
        return short_path(inp.get("file_path") or inp.get("notebook_path")), detail
    if name in ("Glob", "Grep"):
        return str(inp.get("pattern", ""))[:200], json.dumps(inp, ensure_ascii=False)[:1000]
    if name == "WebFetch":
        return str(inp.get("url", ""))[:200], str(inp.get("prompt", ""))[:1000]
    if name == "WebSearch":
        return str(inp.get("query", ""))[:200], ""
    if name in ("Task", "Agent"):
        return str(inp.get("description", ""))[:200], str(inp.get("prompt", ""))[:2000]
    if name == "TodoWrite":
        todos = inp.get("todos") or []
        lines = [("✓ " if t.get("status") == "completed" else "→ " if t.get("status") == "in_progress" else "· ")
                 + str(t.get("content", "")) for t in todos if isinstance(t, dict)]
        return "lista attività", "\n".join(lines)[:3000]
    return "", json.dumps(inp, ensure_ascii=False)[:1500]


def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for c in content:
            if isinstance(c, dict):
                out.append(c.get("text") or ("[immagine]" if c.get("type") == "image" else ""))
        return "\n".join(out)
    return str(content or "")


class Run:
    def __init__(self, conv, prompt):
        self.conv = conv
        self.prompt = prompt
        self.cwd = safe_dir(conv["folder"])
        self.events = []
        self.cond = threading.Condition()
        self.done = False
        self.stopped = False
        self.proc = None
        self.blocks = []
        self.tool_index = {}
        self.streamed_msgs = set()
        self.cur_msg = None
        self.meta = {}
        self.sid = conv.get("claude_sid")
        self.started = time.time()
        self.key = secrets.token_urlsafe(24)

    def emit(self, ev):
        with self.cond:
            self.events.append(ev)
            self.cond.notify_all()

    def cmd(self):
        c = [claude_bin(), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
             "--permission-mode", self.conv["mode"], "--append-system-prompt", notes() + team_prompt(self.conv)]
        if self.conv.get("team_id"):
            c += ["--allowedTools", f"Bash(python3 {TEAM_PY}:*)"]
        for d in extra_dirs(self.conv):
            c += ["--add-dir", d]
        if self.conv["model"]:
            c += ["--model", self.conv["model"]]
        if self.conv.get("effort") and self.conv["model"] != "haiku":   # Haiku non ha i livelli di effort
            c += ["--effort", self.conv["effort"]]
        if self.sid:
            c += ["--resume", self.sid]
        return c

    def handle(self, d):
        if d.get("parent_tool_use_id"):           # dettagli interni dei sotto-agenti: non li mostriamo
            return
        t = d.get("type")
        if d.get("session_id") and t in ("system", "result") and d["session_id"] != self.sid:
            self.sid = d["session_id"]
            q("UPDATE convs SET claude_sid = ? WHERE id = ?", (self.sid, self.conv["id"]))
        if t == "stream_event":
            ev = d.get("event") or {}
            et = ev.get("type")
            if et == "message_start":
                self.cur_msg = (ev.get("message") or {}).get("id")
            elif et == "content_block_start" and (ev.get("content_block") or {}).get("type") == "text":
                self.blocks.append({"type": "text", "text": ""})
                self.emit({"op": "text_start"})
            elif et == "content_block_delta" and (ev.get("delta") or {}).get("type") == "text_delta":
                piece = ev["delta"].get("text", "")
                if not self.blocks or self.blocks[-1]["type"] != "text":
                    self.blocks.append({"type": "text", "text": ""})
                    self.emit({"op": "text_start"})
                self.blocks[-1]["text"] += piece
                self.streamed_msgs.add(self.cur_msg)
                self.emit({"op": "text", "d": piece})
        elif t == "assistant":
            msg = d.get("message") or {}
            for c in msg.get("content") or []:
                if c.get("type") == "text" and msg.get("id") not in self.streamed_msgs and c.get("text"):
                    self.blocks.append({"type": "text", "text": c["text"]})
                    self.emit({"op": "text_start"})
                    self.emit({"op": "text", "d": c["text"]})
                elif c.get("type") == "tool_use":
                    summary, detail = summarize_tool(c.get("name"), c.get("input"), self.cwd)
                    b = {"type": "tool", "id": c.get("id"), "name": c.get("name"), "summary": summary,
                         "detail": detail, "status": "run"}
                    self.tool_index[c.get("id")] = b
                    self.blocks.append(b)
                    self.emit({"op": "tool", "block": b})
        elif t == "user":
            for c in (d.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    b = self.tool_index.get(c.get("tool_use_id"))
                    if b:
                        txt = result_text(c.get("content"))
                        b["status"] = "err" if c.get("is_error") else "ok"
                        b["result"] = txt[:4000] + ("\n…" if len(txt) > 4000 else "")
                        self.emit({"op": "result", "id": b["id"], "status": b["status"], "result": b["result"]})
        elif t == "result":
            self.meta.update({"cost": d.get("total_cost_usd"), "ms": d.get("duration_ms"),
                              "turns": d.get("num_turns"), "subtype": d.get("subtype")})
            if d.get("is_error") or (d.get("subtype") or "success") != "success":
                err = d.get("result") or "; ".join(map(str, d.get("errors") or [])) or d.get("subtype")
                self.meta["error"] = explain_error(str(err))
            if d.get("permission_denials"):
                self.meta["denied"] = sorted({str(x.get("tool_name")) for x in d["permission_denials"]
                                              if isinstance(x, dict)})

    def run(self):
        stderr_tail = []
        try:
            if not claude_bin():
                raise RuntimeError("Claude Code non è installato sul NAS (manca ~/.local/bin/claude).")
            os.makedirs(self.cwd, exist_ok=True)
            env = claude_env()
            if self.conv.get("team_id"):
                AGENT_KEYS[self.key] = self.conv["id"]
                env.update(CANTIERE_KEY=self.key, CANTIERE_URL=f"http://127.0.0.1:{PORT}")
            self.proc = subprocess.Popen(self.cmd(), cwd=self.cwd, env=env, stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                         encoding="utf-8", errors="replace", bufsize=1, start_new_session=True)

            def read_err():
                for line in self.proc.stderr:
                    stderr_tail.append(line)
                    del stderr_tail[:-40]
            threading.Thread(target=read_err, daemon=True).start()
            timer = threading.Timer(RUN_TIMEOUT, self.stop)
            timer.daemon = True
            timer.start()
            self.proc.stdin.write(self.prompt)
            self.proc.stdin.close()
            for line in self.proc.stdout:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    self.handle(json.loads(line))
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
            rc = self.proc.wait()
            timer.cancel()
            if self.stopped:
                self.meta["stopped"] = True
            elif rc != 0 and "error" not in self.meta and "subtype" not in self.meta:
                self.meta["error"] = explain_error("".join(stderr_tail) or f"Claude Code è uscito con codice {rc}")
        except Exception as e:   # noqa: BLE001 – qualunque problema va mostrato nella chat
            self.meta["error"] = str(e)
        finally:
            for b in self.blocks:
                if b["type"] == "tool" and b["status"] == "run":
                    b["status"] = "stop"
            self.meta["seconds"] = round(time.time() - self.started)
            now = int(time.time())
            q("INSERT INTO msgs (conv_id, role, blocks, meta, created) VALUES (?,?,?,?,?)",
              (self.conv["id"], "assistant", json.dumps(self.blocks, ensure_ascii=False),
               json.dumps(self.meta, ensure_ascii=False), now))
            q("UPDATE convs SET updated = ? WHERE id = ?", (now, self.conv["id"]))
            with _lock:
                RUNS.pop(self.conv["id"], None)
                AGENT_KEYS.pop(self.key, None)
            with self.cond:
                self.done = True
                self.events.append({"op": "done", "meta": self.meta})
                self.cond.notify_all()
            dispatch()   # si è liberato un posto: consegna i messaggi in coda

    def stop(self):
        self.stopped = True
        p = self.proc
        if p and p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGTERM)
                threading.Timer(5, lambda: p.poll() is None and os.killpg(p.pid, signal.SIGKILL)).start()
            except (ProcessLookupError, PermissionError):
                pass


def conv_dirs(conv):
    try:
        v = json.loads(conv.get("dirs") or "[]")
        return [str(x) for x in v] if isinstance(v, list) else []
    except ValueError:
        return []


def extra_dirs(conv):
    """Cartelle che Claude può usare oltre alla sua: quelle scelte dall'utente e, per i membri di un team,
    la cartella del team (così vedono il lavoro degli altri)."""
    rels = conv_dirs(conv)
    if conv.get("team_id"):
        t = q("SELECT folder FROM teams WHERE id = ?", (conv["team_id"],), one=True)
        if t:
            rels.append(t["folder"])
    out, own = [], safe_dir(conv["folder"])
    for r in rels:
        try:
            full = safe_dir(r)
        except ValueError:
            continue
        if os.path.isdir(full) and full != own and full not in out:
            out.append(full)
    return out


# ---------- team: più conversazioni che si scrivono ----------
def team_members(team_id):
    return q("SELECT * FROM convs WHERE team_id = ? ORDER BY created, rowid", (team_id,))


def team_prompt(conv):
    if not conv.get("team_id"):
        return ""
    t = q("SELECT * FROM teams WHERE id = ?", (conv["team_id"],), one=True)
    if not t:
        return ""
    others = "\n".join(f"- «{m['role']}» (cartella ~/{m['folder']})" for m in team_members(t["id"])
                       if m["id"] != conv["id"])
    return f"""

## Lavori in un team
Sei «{conv['role']}» nel team «{t['title']}» del Cantiere. Gli altri membri sono conversazioni di Claude Code
come te, ognuna nella sua cartella:
{others or '- (nessun altro membro)'}

Per scrivere a un membro usa Bash, esattamente in questa forma (testo lungo con un heredoc):
    python3 {TEAM_PY} invia <ruolo> <<'FINE'
    testo del messaggio
    FINE
`python3 {TEAM_PY} membri` mostra i membri e cosa stanno facendo.
Regole:
- Il messaggio viene consegnato e il destinatario lavora per conto suo. Non aspettare la risposta in un
  ciclo (niente sleep): finisci il tuo turno; la risposta ti arriverà come nuovo messaggio «da …».
- Scrivi messaggi completi e autonomi (chi li riceve non vede la tua chat): cosa fare, dove, cosa restituire.
- Quando ricevi un compito da un membro, alla fine rispondigli con lo stesso comando.
- Quello che scrivi normalmente in chat lo legge l'utente nella vista Team: tienilo breve.
- Dopo {t['max_hops']} scambi automatici consecutivi il comando si blocca finché l'utente non riscrive.
- Permessi: qui NON esistono richieste di approvazione da accettare una per una. Se un comando o una cartella
  ti vengono bloccati, non riprovare in altri modi: scrivi in chat (breve) cosa ti serve, cioè il modo
  («Autonomo» per lanciare programmi/test) oppure la cartella da aggiungere (percorso esatto). L'utente lo
  imposta toccando il tuo nome nella vista Team (modo, modello, effort, «cartelle in più») e ti fa riprovare.
  Se un altro membro ti dice di essere bloccato, riferisci all'utente la stessa cosa.
"""


def team_out(t, full=False):
    t = dict(t)
    ms = team_members(t["id"])
    queued = {r["conv_id"]: r["n"] for r in q("SELECT conv_id, COUNT(*) AS n FROM inbox GROUP BY conv_id")}
    t["members"] = [dict(conv_out(m), queued=queued.get(m["id"], 0)) for m in ms]
    t["running"] = any(m["running"] or m["queued"] for m in t["members"])
    if full:
        ids = [m["id"] for m in ms]
        role = {m["id"]: m["role"] for m in ms}
        rows = q(f"SELECT * FROM msgs WHERE conv_id IN ({','.join('?' * len(ids))}) ORDER BY created, id",
                 ids) if ids else []
        tl = []
        for r in rows[-400:]:
            blocks, meta = json.loads(r["blocks"]), json.loads(r["meta"])
            text = "\n\n".join(b["text"] for b in blocks if b.get("type") == "text" and b.get("text", "").strip())
            item = {"conv": r["conv_id"], "role": role[r["conv_id"]], "created": r["created"], "text": text}
            if r["role"] == "user":
                item.update(kind="msg", **{"from": meta.get("from") or "tu"})
            else:
                item.update(kind="work", tools=sum(1 for b in blocks if b.get("type") == "tool"),
                            error=meta.get("error"), stopped=meta.get("stopped"), seconds=meta.get("seconds"),
                            denied=meta.get("denied"))
                if not text and not item["tools"] and not item["error"] and not item["denied"]:
                    continue
            tl.append(item)
        t["timeline"] = tl
    return t


def deliver(conv, from_role, text):
    """Mette il messaggio nella coda del membro; dispatch() lo consegna appena possibile."""
    q("INSERT INTO inbox (conv_id, from_role, text, created) VALUES (?,?,?,?)",
      (conv["id"], from_role, text[:30000], int(time.time())))
    dispatch()


def dispatch():
    """Consegna i messaggi in coda ai membri fermi, rispettando MAX_RUNS."""
    started = []
    with _lock:
        for row in q("SELECT conv_id, MIN(id) AS first FROM inbox GROUP BY conv_id ORDER BY first"):
            if len(RUNS) >= MAX_RUNS:
                break
            cid = row["conv_id"]
            if cid in RUNS:
                continue
            c = q("SELECT * FROM convs WHERE id = ?", (cid,), one=True)
            items = q("SELECT * FROM inbox WHERE conv_id = ? ORDER BY id", (cid,))
            q("DELETE FROM inbox WHERE conv_id = ?", (cid,))
            if not c:
                continue
            parts = []
            for it in items:
                blocks = [{"type": "text", "text": it["text"]}]
                q("INSERT INTO msgs (conv_id, role, blocks, meta, created) VALUES (?,?,?,?,?)",
                  (cid, "user", json.dumps(blocks, ensure_ascii=False),
                   json.dumps({"from": it["from_role"]}, ensure_ascii=False), it["created"]))
                head = "Messaggio dall'utente" if it["from_role"] == "tu" else f"Messaggio da «{it['from_role']}» (membro del team)"
                parts.append(f"{head}:\n{it['text']}")
            q("UPDATE convs SET updated = ? WHERE id = ?", (int(time.time()), cid))
            run = Run(c, "\n\n---\n\n".join(parts))
            RUNS[cid] = run
            started.append(run)
    for run in started:
        threading.Thread(target=run.run, daemon=True).start()


def clean_role(v):
    r = re.sub(r"[^\w\-]+", "-", str(v or "").strip().lower()).strip("-")[:30]
    if not r:
        raise ValueError("Ogni membro ha bisogno di un nome (es. capo, backend, grafica)")
    return r


def create_team(body):
    title = re.sub(r"\s+", " ", str(body.get("title") or "")).strip()[:60] or "Nuovo team"
    base = safe_dir(body.get("folder"))
    if not os.path.isdir(base):
        raise ValueError("Cartella del team inesistente")
    members = body.get("members") or []
    if not 2 <= len(members) <= 6:
        raise ValueError("Un team ha da 2 a 6 membri")
    rows, seen = [], set()
    for m in members:
        role = clean_role(m.get("role"))
        if role in seen or role == "tu":
            raise ValueError(f"Nome ripetuto o non valido: {role}")
        seen.add(role)
        sub = str(m.get("folder") or "").strip().strip("/")
        full = safe_dir(os.path.join(rel_of(base), sub)) if sub else base
        os.makedirs(full, exist_ok=True)
        rows.append((role, rel_of(full), m.get("mode") if m.get("mode") in MODES else "acceptEdits",
                     m.get("model") if m.get("model") in MODELS else ""))
    tid, now = secrets.token_hex(6), int(time.time())
    q("INSERT INTO teams (id, title, folder, max_hops, created, updated) VALUES (?,?,?,?,?,?)",
      (tid, title, rel_of(base), MAX_HOPS, now, now))
    for i, (role, folder, mode, model) in enumerate(rows):
        q("INSERT INTO convs (id, title, folder, model, mode, effort, team_id, role, created, updated) "
          "VALUES (?,?,?,?,?,?,?,?,?,?)", (secrets.token_hex(6), f"{title} · {role}", folder, model, mode, "",
                                          tid, role, now + i, now))
    return tid


def conv_out(c):
    c = dict(c)
    c["running"] = c["id"] in RUNS
    c["dirs"] = conv_dirs(c)
    c.pop("claude_sid", None)
    return c


def test_claude():
    if not claude_bin():
        return False, "Claude Code non è installato sul NAS."
    try:
        r = subprocess.run([claude_bin(), "-p", "Rispondi solo con la parola: funziona", "--output-format", "text",
                            "--no-session-persistence"], cwd=BASE, env=claude_env(), capture_output=True,
                           text=True, timeout=120, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return False, "Claude Code non ha risposto in tempo."
    if r.returncode != 0:
        return False, explain_error(r.stderr or r.stdout)
    return True, r.stdout.strip()[:200]


# ---------- HTTP ----------
# ---------- aggiornamenti da GitHub ----------
UPDATE_LOG = os.path.join(BASE, "update.log")
UPDATE_EVERY = 10 * 60           # controllo automatico (GitHub concede 60 richieste/ora senza token)
UPDATE_STALE = 3 * 60            # aprendo l'app, ricontrolla se l'ultimo controllo è più vecchio
_upd = {"latest": None, "checked": None, "error": None, "proc": None, "checking": False}
_upd_lock = threading.Lock()


def installed_version():
    """Legge VERSION scritto da update.py: '<sha> <data>' oppure 'zip <data>', poi il messaggio."""
    try:
        with open(os.path.join(BASE, "VERSION")) as f:
            lines = f.read().splitlines()
    except OSError:
        lines = []
    first = lines[0].split() if lines else []
    msg = lines[1].strip() if len(lines) > 1 else ""
    if not first:
        return {"sha": None, "label": "sconosciuta", "message": ""}
    if first[0] == "zip":
        return {"sha": None, "label": "da zip" + (f" del {first[1]}" if len(first) > 1 else ""), "message": msg}
    return {"sha": first[0], "label": first[0][:7], "message": msg}


def check_updates():
    try:
        head = updater.get(f"https://api.github.com/repos/{updater.REPO}/commits/{updater.BRANCH}")
        c = head["commit"]
        latest = {"sha": head["sha"], "message": c["message"].splitlines()[0][:200], "date": c["committer"]["date"]}
        err = None
    except urllib.error.HTTPError as e:
        latest, err = None, f"GitHub ha risposto {e.code}" + (" (repository privato? serve github-token.txt)" if e.code == 404 else "")
    except Exception:
        latest, err = None, "GitHub non raggiungibile: riprova più tardi"
    with _upd_lock:
        if latest:
            _upd["latest"] = latest
        _upd["error"], _upd["checked"] = err, int(time.time() * 1000)


def check_if_stale(wait=5):
    with _upd_lock:
        fresh = _upd["checked"] and time.time() * 1000 - _upd["checked"] < UPDATE_STALE * 1000
        if fresh or _upd["checking"]:
            return
        _upd["checking"] = True

    def run():
        try:
            check_updates()
        finally:
            with _upd_lock:
                _upd["checking"] = False
    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(wait)


def update_loop():
    time.sleep(30)
    while True:
        check_updates()
        time.sleep(UPDATE_EVERY)


def update_log_tail(n=3):
    try:
        with open(UPDATE_LOG) as f:
            lines = [l.strip() for l in f if l.strip()]
        return " · ".join(lines[-n:]) or "nessun dettaglio"
    except OSError:
        return "nessun dettaglio"


def update_step():
    """A che punto è update.py, letto da update.log: 0 avvio, 1 copia del db, 2 file installati, 3 riavvio."""
    try:
        with open(UPDATE_LOG) as f:
            log = f.read()
    except OSError:
        return 0
    return 3 if "avviato" in log or "Fatto" in log else 2 if "Aggiornati" in log else 1 if "Copia del database" in log else 0


def busy_list():
    """Chi sta lavorando (o ha messaggi in coda): finché c'è qualcuno l'aggiornamento resta bloccato,
    perché il riavvio interromperebbe le risposte."""
    ids = set(RUNS) | {r["conv_id"] for r in q("SELECT DISTINCT conv_id FROM inbox")}
    out = []
    for cid in ids:
        c = q("SELECT title, role, team_id FROM convs WHERE id = ?", (cid,), one=True)
        if c:
            out.append(c["title"] if not c["team_id"] else c["title"].split(" · ")[0] + " · " + c["role"])
    return sorted(out)


def update_status():
    cur = installed_version()
    with _upd_lock:
        latest, proc = _upd["latest"], _upd["proc"]
        code = proc.poll() if proc else None
        return {"version": APP_VERSION, "busy": busy_list(), "installed": cur, "latest": latest, "checked": _upd["checked"], "error": _upd["error"],
                "available": bool(latest and latest["sha"] != cur["sha"]),
                "running": bool(proc and code is None),
                "step": update_step() if proc and code is None else None,
                "failed": update_log_tail() if proc and code not in (None, 0) else None}


def start_update():
    """Lancia update.py in una sessione separata: sopravvive al riavvio del server che lui stesso fa."""
    with _upd_lock:
        if _upd["proc"] and _upd["proc"].poll() is None:
            return False
        with open(UPDATE_LOG, "w") as log:
            _upd["proc"] = subprocess.Popen([sys.executable, "-u", os.path.join(BASE, "update.py")], cwd=BASE,
                                            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                            start_new_session=True)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "Cantiere/1"

    def log_message(self, fmt, *args):
        if os.environ.get("CANTIERE_LOG"):
            super().log_message(fmt, *args)

    def send_json(self, status, payload, extra_headers=()):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=64 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("Richiesta troppo grande")
        data = json.loads(self.rfile.read(n) if n else b"{}")
        if not isinstance(data, dict):
            raise ValueError("JSON non valido")
        return data

    def cookie(self, token, max_age):
        parts = [f"{COOKIE}={token}", "Path=/", f"Max-Age={max_age}", "HttpOnly", "SameSite=Strict"]
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            parts.append("Secure")
        return ("Set-Cookie", "; ".join(parts))

    def logged(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        if COOKIE not in jar:
            return False
        tok = jar[COOKIE].value
        row = q("SELECT created FROM sessions WHERE token = ?", (tok,), one=True)
        if not row or row["created"] + SESSION_AGE < time.time():
            return False
        q("UPDATE sessions SET last_seen = ? WHERE token = ?", (int(time.time()), tok))
        return True

    def same_origin(self):
        """Protezione CSRF (oltre al cookie SameSite=Strict): un altro sito non può inviare JSON
        né fare DELETE/PATCH senza un permesso CORS, che questo server non concede mai."""
        if self.command == "DELETE":
            return True
        return self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"

    def agent(self):
        """Membro di un team che chiama da team.py: la chiave vale solo finché la sua risposta è in corso."""
        cid = AGENT_KEYS.get(self.headers.get("X-Cantiere-Key") or "")
        c = q("SELECT * FROM convs WHERE id = ?", (cid,), one=True) if cid else None
        if not c or not c["team_id"]:
            self.send_json(403, {"error": "Chiave non valida: team.py funziona solo dentro una risposta di un membro del team"})
            return None
        return c

    def conv_or_404(self, cid):
        c = q("SELECT * FROM convs WHERE id = ?", (cid,), one=True) if ID_RE.match(cid or "") else None
        if not c:
            self.send_json(404, {"error": "Conversazione non trovata"})
        return c

    # ----- GET -----
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        if not path.startswith("/api/"):
            return self.serve_static(path)
        if path == "/api/state":
            return self.send_json(200, {"configured": os.path.exists(AUTH_FILE), "logged": self.logged()})
        if path == "/api/agent/team":
            c = self.agent()
            if not c:
                return
            t = team_out(q("SELECT * FROM teams WHERE id = ?", (c["team_id"],), one=True))
            return self.send_json(200, {"me": c["role"], "team": t["title"], "hops": t["hops"], "maxHops": t["max_hops"],
                                        "members": [{"role": m["role"], "folder": m["folder"], "running": m["running"],
                                                     "queued": m["queued"]} for m in t["members"]]})
        if not self.logged():
            return self.send_json(401, {"error": "Accedi"})
        if path == "/api/settings":
            tok = claude_token()
            exp = None
            if tok and tok.get("saved"):
                exp = (datetime.date.fromisoformat(tok["saved"]) + datetime.timedelta(days=365)).isoformat()
            return self.send_json(200, {"claudeInstalled": bool(claude_bin()), "tokenSaved": bool(tok),
                                        "tokenExpires": exp, "root": ROOT, "notes": notes(),
                                        "maxRuns": MAX_RUNS})
        if path == "/api/update":
            check_if_stale()
            return self.send_json(200, update_status())
        if path == "/api/folders":
            try:
                full = safe_dir((parse_qs(u.query).get("path") or [""])[0])
                dirs = sorted((e.name for e in os.scandir(full)
                               if e.is_dir() and not e.name.startswith(".") and e.name != "@eaDir"),
                              key=str.lower)
            except (ValueError, OSError) as e:
                return self.send_json(400, {"error": str(e)})
            rel = rel_of(full)
            return self.send_json(200, {"path": rel, "root": ROOT, "dirs": dirs,
                                        "parent": None if not rel else os.path.dirname(rel)})
        if path == "/api/convs":
            rows = q("SELECT * FROM convs WHERE team_id = '' ORDER BY updated DESC")
            return self.send_json(200, {"convs": [conv_out(c) for c in rows]})
        if path == "/api/teams":
            return self.send_json(200, {"teams": [team_out(t) for t in q("SELECT * FROM teams ORDER BY updated DESC")]})
        m = re.match(r"^/api/teams/([a-f0-9]{12})$", path)
        if m:
            t = q("SELECT * FROM teams WHERE id = ?", (m.group(1),), one=True)
            return self.send_json(200, {"team": team_out(t, full=True)}) if t else self.send_json(404, {"error": "Team non trovato"})
        m = re.match(r"^/api/convs/([^/]+)(/events)?$", path)
        if m:
            c = self.conv_or_404(m.group(1))
            if not c:
                return
            if m.group(2):
                return self.stream(c["id"], int(self.headers.get("Last-Event-ID") or
                                                (parse_qs(u.query).get("after") or ["0"])[0] or 0))
            msgs = q("SELECT id, role, blocks, meta, created FROM msgs WHERE conv_id = ? ORDER BY id", (c["id"],))
            for x in msgs:
                x["blocks"] = json.loads(x["blocks"])
                x["meta"] = json.loads(x["meta"])
            return self.send_json(200, {"conv": conv_out(c), "msgs": msgs})
        return self.send_json(404, {"error": "Non trovato"})

    def stream(self, cid, after):
        run = RUNS.get(cid)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            if not run:
                self.wfile.write(b'data: {"op":"idle"}\n\n')
                return
            i = max(0, after)
            while True:
                with run.cond:
                    if i >= len(run.events) and not run.done:
                        run.cond.wait(15)
                    batch = run.events[i:]
                if not batch:
                    self.wfile.write(b": ping\n\n")
                for ev in batch:
                    i += 1
                    self.wfile.write(f"id: {i}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n".encode())
                self.wfile.flush()
                if run.done and i >= len(run.events):
                    return
        except (BrokenPipeError, ConnectionResetError):
            return

    # ----- POST -----
    def do_POST(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json(403, {"error": "Origine non valida"})
        try:
            if path == "/api/login":
                body = self.read_json()
                now = time.time()
                if now < _login_fail["until"]:
                    return self.send_json(429, {"error": "Troppi tentativi: aspetta un minuto"})
                if not os.path.exists(AUTH_FILE):
                    return self.send_json(400, {"error": "Password non impostata: sul NAS lancia python3 imposta-password.py"})
                if not check_password(str(body.get("password") or "")):
                    _login_fail["n"] += 1
                    if _login_fail["n"] >= 5:
                        _login_fail.update(n=0, until=now + 60)
                    time.sleep(1)
                    return self.send_json(401, {"error": "Password sbagliata"})
                _login_fail["n"] = 0
                tok = secrets.token_urlsafe(32)
                q("INSERT INTO sessions VALUES (?,?,?)", (tok, int(now), int(now)))
                return self.send_json(200, {"ok": True}, [self.cookie(tok, SESSION_AGE)])
            if path == "/api/agent/send":
                c = self.agent()
                if not c:
                    return
                body = self.read_json(limit=256 * 1024)
                text = str(body.get("text") or "").strip()
                to = clean_role(body.get("to"))
                dest = q("SELECT * FROM convs WHERE team_id = ? AND role = ?", (c["team_id"], to), one=True)
                if not text:
                    return self.send_json(400, {"error": "Messaggio vuoto"})
                if not dest or dest["id"] == c["id"]:
                    roles = ", ".join(m["role"] for m in team_members(c["team_id"]) if m["id"] != c["id"])
                    return self.send_json(400, {"error": f"Nessun membro «{to}». Membri: {roles}"})
                with _lock:
                    t = q("SELECT * FROM teams WHERE id = ?", (c["team_id"],), one=True)
                    if t["hops"] >= t["max_hops"]:
                        return self.send_json(429, {"error": f"Limite di {t['max_hops']} scambi automatici raggiunto: "
                                                             "non inviato. Riassumi in chat a che punto siete e aspetta l'utente."})
                    q("UPDATE teams SET hops = hops + 1, updated = ? WHERE id = ?", (int(time.time()), t["id"]))
                deliver(dest, c["role"], text)
                return self.send_json(200, {"ok": True, "to": to, "hops": t["hops"] + 1, "maxHops": t["max_hops"]})
            if not self.logged():
                return self.send_json(401, {"error": "Accedi"})
            if path == "/api/logout":
                jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
                if COOKIE in jar:
                    q("DELETE FROM sessions WHERE token = ?", (jar[COOKIE].value,))
                return self.send_json(200, {"ok": True}, [self.cookie("", 0)])
            if path == "/api/settings":
                body = self.read_json()
                if "token" in body:
                    t = str(body.get("token") or "").strip()
                    if not t:
                        try:
                            os.remove(TOKEN_FILE)
                        except OSError:
                            pass
                    elif not t.startswith("sk-ant-"):
                        return self.send_json(400, {"error": "Non sembra un token di claude setup-token (inizia con sk-ant-)"})
                    else:
                        save_secret(TOKEN_FILE, json.dumps({"token": t, "saved": datetime.date.today().isoformat()}))
                if "notes" in body:
                    with open(NOTES_FILE, "w", encoding="utf-8") as f:
                        f.write(str(body["notes"])[:20000])
                return self.send_json(200, {"ok": True})
            if path == "/api/update/check":
                check_updates()
                return self.send_json(200, update_status())
            if path == "/api/update/run":
                busy = busy_list()
                if busy:
                    return self.send_json(409, {"error": "Aggiornamento bloccato: sta lavorando " + ", ".join(busy)
                                                         + ". Si sblocca da solo quando hanno finito."})
                if not start_update():
                    return self.send_json(409, {"error": "Aggiornamento già in corso"})
                return self.send_json(200, {"ok": True})
            if path == "/api/settings/test":
                ok, msg = test_claude()
                return self.send_json(200, {"ok": ok, "message": msg})
            if path == "/api/folders":
                body = self.read_json()
                name = str(body.get("name") or "").strip()
                if not re.match(r"^[\w][\w .\-]{0,60}$", name):
                    return self.send_json(400, {"error": "Nome cartella non valido (lettere, numeri, - _ .)"})
                full = os.path.join(safe_dir(body.get("path")), name)
                os.makedirs(full, exist_ok=True)
                return self.send_json(200, {"path": rel_of(full)})
            if path == "/api/convs":
                body = self.read_json()
                full = safe_dir(body.get("folder"))
                if not os.path.isdir(full):
                    return self.send_json(400, {"error": "Cartella inesistente"})
                mode = body.get("mode") if body.get("mode") in MODES else "acceptEdits"
                model = body.get("model") if body.get("model") in MODELS else ""
                effort = body.get("effort") if body.get("effort") in EFFORTS else ""
                cid, now = secrets.token_hex(6), int(time.time())
                q("INSERT INTO convs (id, title, folder, model, mode, effort, created, updated) VALUES (?,?,?,?,?,?,?,?)",
                  (cid, "Nuova conversazione", rel_of(full), model, mode, effort, now, now))
                return self.send_json(200, {"conv": conv_out(q("SELECT * FROM convs WHERE id = ?", (cid,), one=True))})
            if path == "/api/teams":
                tid = create_team(self.read_json())
                return self.send_json(200, {"team": team_out(q("SELECT * FROM teams WHERE id = ?", (tid,), one=True))})
            m = re.match(r"^/api/teams/([a-f0-9]{12})/(send|stop)$", path)
            if m:
                t = q("SELECT * FROM teams WHERE id = ?", (m.group(1),), one=True)
                if not t:
                    return self.send_json(404, {"error": "Team non trovato"})
                if m.group(2) == "stop":
                    for mb in team_members(t["id"]):
                        q("DELETE FROM inbox WHERE conv_id = ?", (mb["id"],))
                        r = RUNS.get(mb["id"])
                        if r:
                            r.stop()
                    return self.send_json(200, {"ok": True})
                body = self.read_json(limit=256 * 1024)
                text = str(body.get("text") or "").strip()
                dest = q("SELECT * FROM convs WHERE team_id = ? AND role = ?", (t["id"], str(body.get("to") or "")), one=True)
                if not text or not dest:
                    return self.send_json(400, {"error": "Scrivi un messaggio e scegli a chi mandarlo"})
                q("UPDATE teams SET hops = 0, updated = ? WHERE id = ?", (int(time.time()), t["id"]))
                deliver(dest, "tu", text)
                return self.send_json(200, {"ok": True, "queued": dest["id"] not in RUNS})
            m = re.match(r"^/api/convs/([^/]+)/(send|stop)$", path)
            if m:
                c = self.conv_or_404(m.group(1))
                if not c:
                    return
                if m.group(2) == "stop":
                    r = RUNS.get(c["id"])
                    if r:
                        r.stop()
                    return self.send_json(200, {"ok": True})
                return self.send(c, self.read_json(limit=40 * 1024 * 1024))
            return self.send_json(404, {"error": "Non trovato"})
        except (ValueError, OSError) as e:
            return self.send_json(400, {"error": str(e)})

    def send(self, c, body):
        text = str(body.get("text") or "").strip()
        files = body.get("files") or []
        if not text and not files:
            return self.send_json(400, {"error": "Messaggio vuoto"})
        with _lock:
            if c["id"] in RUNS:
                return self.send_json(409, {"error": "Claude sta ancora rispondendo in questa conversazione"})
            if len(RUNS) >= MAX_RUNS:
                return self.send_json(429, {"error": f"Già {MAX_RUNS} conversazioni al lavoro: aspetta che una finisca"})
            cwd = safe_dir(c["folder"])
            saved = []
            if files:
                adir = os.path.join(cwd, "allegati")
                os.makedirs(adir, exist_ok=True)
                for f in files[:10]:
                    name = time.strftime("%Y%m%d-%H%M%S-") + clean_filename(f.get("name"))
                    with open(os.path.join(adir, name), "wb") as out:
                        out.write(base64.b64decode(str(f.get("data") or "")))
                    saved.append("allegati/" + name)
            prompt = text
            if saved:
                prompt = ("Ho allegato questi file (percorsi relativi alla cartella corrente; aprili con Read):\n"
                          + "\n".join("- " + s for s in saved) + "\n\n" + (text or "Guarda gli allegati."))
            now = int(time.time())
            blocks = [{"type": "text", "text": text}] + ([{"type": "files", "files": saved}] if saved else [])
            q("INSERT INTO msgs (conv_id, role, blocks, created) VALUES (?,?,?,?)",
              (c["id"], "user", json.dumps(blocks, ensure_ascii=False), now))
            if c["title"] == "Nuova conversazione" and text:
                title = re.sub(r"\s+", " ", text)[:60]
                q("UPDATE convs SET title = ? WHERE id = ?", (title, c["id"]))
            q("UPDATE convs SET updated = ? WHERE id = ?", (now, c["id"]))
            if c.get("team_id"):
                q("UPDATE teams SET hops = 0, updated = ? WHERE id = ?", (now, c["team_id"]))
            run = Run(c, prompt)
            RUNS[c["id"]] = run
        threading.Thread(target=run.run, daemon=True).start()
        return self.send_json(200, {"ok": True})

    # ----- PATCH / DELETE -----
    def do_PATCH(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json(403, {"error": "Origine non valida"})
        if not self.logged():
            return self.send_json(401, {"error": "Accedi"})
        mt = re.match(r"^/api/teams/([a-f0-9]{12})$", path)
        if mt:
            t = q("SELECT * FROM teams WHERE id = ?", (mt.group(1),), one=True)
            if not t:
                return self.send_json(404, {"error": "Team non trovato"})
            try:
                body = self.read_json()
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            title = re.sub(r"\s+", " ", str(body.get("title") or "")).strip()[:60]
            if title:
                q("UPDATE teams SET title = ? WHERE id = ?", (title, t["id"]))
            if isinstance(body.get("maxHops"), int) and 1 <= body["maxHops"] <= 50:
                q("UPDATE teams SET max_hops = ? WHERE id = ?", (body["maxHops"], t["id"]))
            return self.send_json(200, {"team": team_out(q("SELECT * FROM teams WHERE id = ?", (t["id"],), one=True))})
        m = re.match(r"^/api/convs/([^/]+)$", path)
        if not m:
            return self.send_json(404, {"error": "Non trovato"})
        c = self.conv_or_404(m.group(1))
        if not c:
            return
        try:
            body = self.read_json()
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        if "title" in body:
            t = re.sub(r"\s+", " ", str(body["title"] or "")).strip()[:80]
            if t:
                q("UPDATE convs SET title = ? WHERE id = ?", (t, c["id"]))
        if body.get("mode") in MODES:
            q("UPDATE convs SET mode = ? WHERE id = ?", (body["mode"], c["id"]))
        if "model" in body and body["model"] in MODELS:
            q("UPDATE convs SET model = ? WHERE id = ?", (body["model"], c["id"]))
        if "effort" in body and body["effort"] in EFFORTS:
            q("UPDATE convs SET effort = ? WHERE id = ?", (body["effort"], c["id"]))
        if isinstance(body.get("dirs"), list):
            rels = []
            for d in body["dirs"][:10]:
                try:
                    full = safe_dir(str(d))
                except ValueError as e:
                    return self.send_json(400, {"error": str(e)})
                if not os.path.isdir(full):
                    return self.send_json(400, {"error": f"Cartella inesistente: ~/{d}"})
                if rel_of(full) not in rels:
                    rels.append(rel_of(full))
            q("UPDATE convs SET dirs = ? WHERE id = ?", (json.dumps(rels), c["id"]))
        return self.send_json(200, {"conv": conv_out(q("SELECT * FROM convs WHERE id = ?", (c["id"],), one=True))})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json(403, {"error": "Origine non valida"})
        if not self.logged():
            return self.send_json(401, {"error": "Accedi"})
        mt = re.match(r"^/api/teams/([a-f0-9]{12})$", path)
        if mt:
            for mb in team_members(mt.group(1)):
                q("DELETE FROM inbox WHERE conv_id = ?", (mb["id"],))
                r = RUNS.get(mb["id"])
                if r:
                    r.stop()
                q("DELETE FROM msgs WHERE conv_id = ?", (mb["id"],))
                q("DELETE FROM convs WHERE id = ?", (mb["id"],))
            q("DELETE FROM teams WHERE id = ?", (mt.group(1),))
            return self.send_json(200, {"ok": True})
        m = re.match(r"^/api/convs/([^/]+)$", path)
        if not m:
            return self.send_json(404, {"error": "Non trovato"})
        c = self.conv_or_404(m.group(1))
        if not c:
            return
        r = RUNS.get(c["id"])
        if r:
            r.stop()
        q("DELETE FROM msgs WHERE conv_id = ?", (c["id"],))
        q("DELETE FROM convs WHERE id = ?", (c["id"],))
        return self.send_json(200, {"ok": True})

    # ----- file statici -----
    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.realpath(os.path.join(APP_DIR, unquote(path).lstrip("/")))
        if not full.startswith(os.path.realpath(APP_DIR) + os.sep) or not os.path.isfile(full):
            full = os.path.join(APP_DIR, "index.html")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def main():
    global ROOT, PORT
    ap = argparse.ArgumentParser(description="Cantiere: chat con Claude Code sul NAS")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--root", default=os.environ.get("CANTIERE_ROOT") or os.path.expanduser("~"),
                    help="Cartella dentro cui Claude può lavorare (default: la tua home)")
    a = ap.parse_args()
    ROOT = os.path.realpath(os.path.expanduser(a.root))
    PORT = a.port
    db()
    notes()
    threading.Thread(target=lambda: (time.sleep(3), dispatch()), daemon=True).start()   # coda rimasta da prima del riavvio
    if not os.path.exists(AUTH_FILE):
        print("ATTENZIONE: password non impostata. Lancia: python3 imposta-password.py", flush=True)
    threading.Thread(target=update_loop, daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    print(f"Cantiere attivo su http://{a.host}:{a.port} (cartelle sotto {ROOT})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
