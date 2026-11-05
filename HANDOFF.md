# Cantiere – riepilogo per riprendere il progetto (5 novembre 2026)

Chat web personale (PWA) per parlare con **Claude Code installato sul NAS** e fargli sviluppare app direttamente lì. Stessa impostazione della Dispensa: solo libreria standard Python, niente Docker/pip, Tailscale per l'HTTPS. La usa solo Mattia (abbonamento Claude Max via token `claude setup-token`).

## Architettura
| File | Ruolo |
|---|---|
| `server.py` | server HTTP + API JSON + SQLite (`cantiere.db`); per ogni messaggio avvia `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode <modo> [--model] [--resume <sessione>]` nella cartella della conversazione, prompt via stdin; trasforma il flusso in eventi semplici (`text_start`, `text`, `tool`, `result`, `done`) e li manda al telefono con Server-Sent Events. La risposta continua anche se il telefono si disconnette; a fine risposta viene salvata nel db |
| `app/index.html`, `app/app.js`, `app/sw.js` | PWA: elenco conversazioni, chat con Markdown, strumenti usati (comandi, file letti/scritti) richiudibili, allegati, scelta modo/modello, impostazioni |
| `imposta-password.py` | password PBKDF2 in `auth.json` (`esci-tutti` scollega tutti i dispositivi) |
| `update.py` | aggiornamento da zip: backup db in `backups/`, sostituisce solo il codice, riavvia |
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
