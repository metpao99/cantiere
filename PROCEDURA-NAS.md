# Cantiere – installazione sul NAS (circa 20 minuti)

Cantiere è una chat con Claude Code che gira sul NAS. Ogni conversazione lavora in una cartella del NAS e Claude ricorda tutto quello che vi siete detti in quella conversazione.

- NAS: UGREEN DH2300, utente SSH `Mattia`.
- Cartella: `/home/Mattia/Cantiere/cantiere-server`.
- Porta: 8766. La Dispensa resta sulla 8765 e non viene toccata.
- Il NAS si spegne alle 23:00: inizia almeno un'ora prima.
- Se un passo dà errore, fermati e copia il messaggio esatto.
- Come per la Dispensa, se puoi scrivi i comandi a mano invece di incollarli.

## 1. Caricare i file
1. UGOS › gestore file › nella tua cartella home crea la cartella **`Cantiere`**.
2. Carica lì dentro `cantiere-2026-11-05.zip`, senza estrarlo.
3. PowerShell: `ssh Mattia@IP-NAS`
4. Estrai lo zip:
   ```
   cd ~/Cantiere
   python3 -m zipfile -e cantiere-2026-11-05.zip .
   cd cantiere-server
   ls
   ```
   Devi vedere `server.py`, `start.sh`, `app` e gli altri file.

## 2. Password (obbligatoria)
Chi entra nella chat può far lavorare Claude sui file del NAS, quindi serve una password.
```
python3 imposta-password.py
```
Usa almeno 10 caratteri. Non si vede mentre la scrivi, ed è normale.

## 3. Collegare il tuo abbonamento Claude
Puoi riusare lo stesso token che hai già generato per la Dispensa:
```
cp ~/Dispensa/dispensa-server/claude-token.json .
```
In alternativa: `~/.local/bin/claude setup-token`, poi incolla il token in **Impostazioni** dentro l'app.

## 4. Avviare e provare in casa
```
sh start.sh
```
Dal telefono o dal PC, collegato al Wi-Fi di casa, apri `http://IP-NAS:8766`:
1. Inserisci la password.
2. Apri **Impostazioni › Prova collegamento**: deve rispondere "Funziona".

## 5. HTTPS con Tailscale (stesso Tailscale della Dispensa)
```
sh tailscale-https.sh
```
Da quel momento l'app è su **`https://nas-dispensa.tailc2b502.ts.net:8443`**: la Dispensa resta senza `:8443`. Funziona ovunque, purché Tailscale sia attivo sul telefono. L'impostazione resta salvata e non va ripetuta.

## 6. Avvio automatico
```
sudo crontab -e
```
In fondo aggiungi questa riga, salva ed esci:
```
@reboot sleep 40; su Mattia -c 'sh /home/Mattia/Cantiere/cantiere-server/start.sh'
```
Controlla con `sudo crontab -l`: devono esserci le due righe della Dispensa, questa nuova e le righe `TimedShutdown`.

## 7. Sull'iPhone
1. Apri l'indirizzo `:8443` in Safari.
2. Tocca **Condividi › Aggiungi alla schermata Home**.
3. Inserisci la password: l'accesso dura 90 giorni.

---

## Come si usa
- **Nuova conversazione**: scegli la cartella in cui Claude deve lavorare. Per esempio `Progetti/nuova-app`, che puoi creare dalla finestra stessa, oppure `Dispensa/dispensa-server`.
- **Cosa può fare Claude**, modificabile in ogni momento dai pulsanti sopra il campo di testo:
  - **Solo piano**: legge e propone, non modifica nulla.
  - **Modifica file**: scrive file e usa comandi semplici. Blocca programmi, test e installazioni, e in quel caso te lo dice.
  - **Autonomo**: fa tutto da solo, come il tuo utente e mai come root. Prima di usarlo su cartelle importanti, come la Dispensa, fai un backup.
- **Allegati** (graffetta): foto, screenshot o file. Vengono salvati in `allegati/` dentro la cartella e Claude li apre da lì.
- **Ferma** (quadrato): interrompe la risposta.
- Puoi chiudere l'app mentre Claude lavora: la risposta continua sul NAS e la ritrovi quando la riapri.
- **Impostazioni › Istruzioni fisse**: regole aggiunte a ogni conversazione. Sono già scritte con le informazioni sul NAS: niente Docker, niente apt, cron vietato e così via.

## Aggiornare il Cantiere
1. Carica il nuovo zip in `~/Cantiere`.
2. Lancia:
   ```
   cd ~/Cantiere/cantiere-server
   python3 update.py ../NOME-NUOVO.zip
   ```
   Lo script copia il database in `backups/`, aggiorna solo il codice e riavvia il server.
3. Sul telefono chiudi e riapri l'app.

Non aggiornare mentre Claude sta rispondendo: la risposta si interrompe.

## Se qualcosa non va
- Log: `tail -50 ~/Cantiere/cantiere-server/server.log`
- Riavvio: `sh ~/Cantiere/cantiere-server/start.sh`
- Per scollegare tutti i dispositivi: `python3 imposta-password.py esci-tutti`
