#!/usr/bin/env python3
"""
Postino dei team del Cantiere: lo usa Claude dentro una conversazione che fa parte di un team.

    python3 team.py membri                       chi c'è nel team e chi sta lavorando
    python3 team.py invia <ruolo> "testo"        manda un messaggio a un membro
    python3 team.py invia <ruolo> <<'FINE'       (testo lungo da stdin)
    ...
    FINE

Funziona solo durante una risposta di un membro: il server passa CANTIERE_URL e CANTIERE_KEY.
"""
import json, os, sys, urllib.error, urllib.request

URL = os.environ.get("CANTIERE_URL", "http://127.0.0.1:8766")
KEY = os.environ.get("CANTIERE_KEY", "")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "X-Cantiere-Key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error")
        except ValueError:
            msg = None
        sys.exit(f"Errore: {msg or e.code}")
    except urllib.error.URLError as e:
        sys.exit(f"Server del Cantiere non raggiungibile: {e.reason}")


def main():
    if not KEY:
        sys.exit("Manca CANTIERE_KEY: team.py funziona solo dentro una conversazione di un team del Cantiere.")
    a = sys.argv[1:]
    if a[:1] == ["membri"]:
        d = call("GET", "/api/agent/team")
        print(f"Team «{d['team']}» – tu sei «{d['me']}» – scambi automatici: {d['hops']}/{d['maxHops']}")
        for m in d["members"]:
            st = "sta lavorando" if m["running"] else "fermo"
            if m["queued"]:
                st += f", {m['queued']} messaggi in coda"
            print(f"- {m['role']}{' (tu)' if m['role'] == d['me'] else ''}: ~/{m['folder']} – {st}")
        return
    if a[:1] == ["invia"] and len(a) >= 2:
        text = " ".join(a[2:]).strip() if len(a) > 2 else sys.stdin.read().strip()
        if not text:
            sys.exit("Messaggio vuoto")
        d = call("POST", "/api/agent/send", {"to": a[1], "text": text})
        print(f"Consegnato a «{d['to']}» (scambi automatici {d['hops']}/{d['maxHops']}). "
              "Non aspettarlo: la risposta arriverà come nuovo messaggio.")
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
