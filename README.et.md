<img src="assets/icon.svg" width="64" height="64" alt="">

# BoardSimple

[In English](README.md)

Kohalik, tasuta lõuend agentide tehtud UI-de ülevaatamiseks. HTML-ekraanid on kõrvuti
artboardidena, lõuend uueneb ise, ja ringiga saab märkida, mida muuta — märkused lähevad
faili, mille agent loeb.

## Paigaldus

Vajab Node 24+. Sõltuvusi pole.

```sh
cd C:\Arendus\boardsimple
npm link
```

## Kasutus

```sh
boardsimple                 # praegune kaust
boardsimple C:\Arendus\mingi-projekt
boardsimple --port 5000 --no-open
```

Lõuend avaneb eraldi aknas (Chrome, Edge, Chromium või Brave `--app`-režiimis): oma taskbar-kirje,
Alt+Tab-is nähtav, tabide vahele ei kao. Aknal on oma profiil (`~/.boardsimple/chrome-profile`), nii et suurus ja
asukoht jäävad meelde. Mujalt klikitud lõuendi link jõuab tavatabi, mis annab töö sellele aknale üle ja sulgeb end.
Kui ühtki neist pole, avaneb tavabrauseris.

Proovi demoga: `boardsimple examples/demo` (inglise keeles `examples/demo-en`).

- **Ekraanid:** `screens/<rühm>/<nimi>.html`, suurus `<meta name="artboard" content="width=390,height=844">`.
- **Tööriistad:** Vali (V) — klõpsa ja keri ekraani sees · Käsi (H või tühik) — nihuta · Ring (O), Kast (B), Joon (P), Nool (A) — märgi. Joon sulgub, kui lõpetad alguse lähedal; muidu jääb allakriipsutuseks. Värv kehtib järgmistele märkidele.
- **Suum:** hiireratas või pinch; "Mahuta kõik" (Shift+1).
- **Agendile:** märkused salvestuvad kohe `.canvas/annotations.json`-i. Vajuta "Kopeeri käsk agendile" ja kleebi vestlusesse.
- **Keel:** äpp järgib brauserit (eesti keel, kui see on loetelus, muidu inglise). ET/EN nupp teema nupu kõrval vahetab keelt ja jätab valiku meelde. Käsurida järgib süsteemi keelt; `BOARDSIMPLE_LANG=et` või `en` kirjutab selle üle.
- **Tõrkeotsing:** kui GPU protsess kukub või lähtestub, tekib rida faili `.canvas/client.log`. Puuduvaid graafikatükke see ei märka.

Agendi juhend projekti `CLAUDE.md`-sse: [AGENTS-BOARDSIMPLE.md](AGENTS-BOARDSIMPLE.md) ([in English](AGENTS-BOARDSIMPLE.en.md)).

Server kuulab ainult `127.0.0.1` ja keeldub võõra `Origin`/`Host` päisega päringutest.

## Arendus

```sh
npm test                      # node-testid
python -I test/e2e/e2e.py     # brauseri e2e (pip install playwright && playwright install chromium)
python -I test/e2e/marks.py   # märkimise tööriistad ja värvid
python -I test/e2e/load.py    # 146 lehe koormusproov; BOARDSIMPLE_E2E_GPU=1 lisab Windowsil GPU mälu piiri
```

CI jooksutab kõik (node-testid Ubuntul ja Windowsil, e2e ja koormusproov Ubuntul). GPU piiri CI ei kontrolli, sest seal pole päris GPU-d.
