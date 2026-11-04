<img src="assets/icon.svg" width="64" height="64" alt="">

# Louend (minu-paber)

Kohalik, tasuta lõuend agentide tehtud UI-de ülevaatamiseks. HTML-ekraanid on kõrvuti
artboardidena, lõuend uueneb ise, ja ringiga saab märkida, mida muuta — märkused lähevad
faili, mille agent loeb.

## Paigaldus

Vajab Node 24+. Sõltuvusi pole.

```sh
cd C:\Arendus\minu-paber
npm link
```

## Kasutus

```sh
louend                 # praegune kaust
louend C:\Arendus\mingi-projekt
louend --port 5000 --no-open
```

Lõuend avaneb eraldi aknas (Chrome, Edge, Chromium või Brave `--app`-režiimis): oma taskbar-kirje,
Alt+Tab-is nähtav, tabide vahele ei kao. Aknal on oma profiil (`~/.louend/chrome-profile`), nii et suurus ja
asukoht jäävad meelde. Kui ühtki neist pole, avaneb tavabrauseris.

Proovi demoga: `louend examples/demo`.

- **Ekraanid:** `screens/<rühm>/<nimi>.html`, suurus `<meta name="artboard" content="width=390,height=844">`.
- **Tööriistad:** Vali (V) — klõpsa ja keri ekraani sees · Käsi (H või tühik) — nihuta · Ring (O) — märgi.
- **Suum:** hiireratas või pinch; "Mahuta kõik" (Shift+1).
- **Agendile:** märkused salvestuvad kohe `.canvas/annotations.json`-i. Vajuta "Kopeeri käsk agendile" ja kleebi vestlusesse.

Agendi juhend projekti `CLAUDE.md`-sse: [AGENTS-LOUEND.md](AGENTS-LOUEND.md).

Server kuulab ainult `127.0.0.1` ja keeldub võõra `Origin`/`Host` päisega päringutest.

## Arendus

```sh
npm test                      # node-testid
python -I test/e2e/e2e.py     # brauseri e2e (pip install playwright && playwright install chromium)
python -I test/e2e/load.py    # 146 lehe koormusproov; LOUEND_E2E_GPU=1 lisab Windowsil GPU mälu piiri
```

CI jooksutab kõik (node-testid Ubuntul ja Windowsil, e2e ja koormusproov Ubuntul). GPU piiri CI ei kontrolli, sest seal pole päris GPU-d.
