# Cantiere – riepilogo per riprendere il progetto (5 novembre 2026)

Chat web personale (PWA) per parlare con **Claude Code installato sul NAS** e fargli sviluppare app direttamente lì. Stessa impostazione della Dispensa: solo libreria standard Python, niente Docker/pip, Tailscale per l'HTTPS. La usa solo Mattia (abbonamento Claude Max via token `claude setup-token`).

## Architettura
| File | Ruolo |
|---|---|
| `server.py` | server HTTP + API JSON + SQLite (`cantiere.db`); per ogni messaggio avvia `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode <modo> [--model] [--resume <sessione>]` nella cartella della conversazione, prompt via stdin; trasforma il flusso in eventi semplici (`text_start`, `text`, `tool`, `result`, `done`) e li manda al telefono con Server-Sent Events. La risposta continua anche se il telefono si disconnette; a fine risposta viene salvata nel db |
| `app/index.html`, `app/app.js`, `app/sw.js` | PWA: elenco conversazioni, chat con Markdown, strumenti usati (comandi, file letti/scritti) richiudibili, allegati, scelta modo/modello, impostazioni |
| `imposta-password.py` | password PBKDF2 in `auth.json` (`esci-tutti` scollega tutti i dispositivi) |
| `team.py` | "postino" dei team: i membri lo lanciano (`invia <ruolo>`, `membri`); parla col server su 127.0.0.1 con la chiave `CANTIERE_KEY` che vale solo durante la risposta |
| `update.py` | aggiornamento da GitHub (`main` di metpao99/cantiere) o da zip (`--zip`): backup db in `backups/`, sostituisce solo il codice, riavvia |
| `start.sh` | avvio in background (porta 8766, ROOT = home) |
| `tailscale-https.sh` | usa il Tailscale della Dispensa: `serve --bg --https=8443 http://127.0.0.1:8766` |

Dati/segreti mai toccati dagli aggiornamenti: `cantiere.db`, `auth.json`, `claude-token.json`, `istruzioni.md`, `backups/`.

## Decisioni
- `claude -p` + `--resume` invece dell'Agent SDK: niente Node/npm da installare, usa il Claude Code già presente e l'abbonamento (richieste solo del proprietario).
- Tre modi di permesso: `plan`, `acceptEdits` (default; blocca programmi/installazioni e la chat lo segnala), `bypassPermissions` ("Autonomo"). Nessuna richiesta di permesso interattiva (in `-p` non esiste senza un server MCP apposito).
- Massimo 2 risposte contemporanee (4 GB di RAM), timeout 45 min per risposta.
- Le cartelle si scelgono solo sotto la home (`--root`); cartelle nascoste non mostrate.
- Protezione: password + cookie HttpOnly/SameSite=Strict 90 gg, blocco 1 min dopo 5 tentativi errati, richieste di modifica solo con JSON (anti-CSRF).

## Idee successive
- Approvare i singoli comandi dal telefono (`--permission-prompt-tool` con un piccolo server MCP).
- Notifica Web Push a fine risposta (riusare `webpush.py` della Dispensa).
- Anteprima delle app create (link alla porta dell'app in sviluppo).
- Pubblicazione su GitHub come per la Dispensa.

## Team (v1.0)
- Scheda **Team** nella barra laterale; le chat singole restano per il botta e risposta.
- Un team = 2–6 conversazioni (`convs.team_id`, `convs.role`) in una cartella base o in sottocartelle.
  Le chat dei membri non compaiono nella lista Chat ma si aprono toccando il membro (pulsante "← Team" per tornare).
- I membri ricevono nelle istruzioni di sistema chi sono e come scrivere agli altri (`team_prompt`), e il
  permesso `--allowedTools "Bash(python3 …/team.py:*)"` anche in modo "Modifica file".
- Messaggi: tabella `inbox` → `dispatch()` li consegna quando il membro è fermo e c'è un posto (MAX_RUNS);
  più messaggi in coda diventano un solo turno. `dispatch()` gira anche a fine di ogni risposta e all'avvio.
- Anti-ciclo: `teams.hops` conta gli scambi automatici; oltre `max_hops` (default 8) `team.py` rifiuta;
  si azzera quando scrive l'utente (vista team o chat del membro).
- La vista team è una cronologia unica (messaggi tra membri + testo finale di ogni turno), aggiornata ogni 2,5 s
  mentre qualcuno lavora.
