#!/usr/bin/env python3
"""Imposta (o cambia) la password per entrare nel Cantiere. Uso: python3 imposta-password.py"""
import getpass, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import AUTH_FILE, hash_password, save_secret

if len(sys.argv) > 1 and sys.argv[1] == "esci-tutti":
    from server import q
    q("DELETE FROM sessions")
    sys.exit("Fatto: tutti i dispositivi dovranno rifare l'accesso.")

pw = getpass.getpass("Nuova password (almeno 10 caratteri, non si vede mentre scrivi): ")
if len(pw) < 10:
    sys.exit("Troppo corta: almeno 10 caratteri. Nessuna modifica.")
if getpass.getpass("Ripetila: ") != pw:
    sys.exit("Le due password non coincidono. Nessuna modifica.")
save_secret(AUTH_FILE, json.dumps(hash_password(pw)))
print("Password salvata. I telefoni già collegati restano collegati; per scollegarli tutti:")
print("  python3 imposta-password.py esci-tutti")
