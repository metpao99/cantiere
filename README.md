# Cantiere

Chat web personale (PWA) per parlare con Claude Code sul NAS. Solo libreria standard Python.
Vedi `HANDOFF.md` (architettura) e `PROCEDURA-NAS.md` (installazione).

## Team
Scheda Team: più sessioni di Claude che si scrivono con `team.py`. Dettagli in `HANDOFF.md`.

## Flusso di lavoro
- `main` = ciò che gira sul NAS. L'app controlla `main` ogni 10 minuti e mostra "Aggiorna ora" in Impostazioni.
- Le modifiche si fanno su un ramo (`git switch -c nome`), si provano, e solo quando piacciono: merge in `main` e `git push`.
- Da terminale: `python3 update.py` (`--check` per sola verifica, `--zip FILE` per aggiornare da zip).
