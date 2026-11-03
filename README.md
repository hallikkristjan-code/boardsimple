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

Proovi demoga: `louend examples/demo`.

- **Ekraanid:** `screens/<rühm>/<nimi>.html`, suurus `<meta name="artboard" content="width=390,height=844">`.
- **Tööriistad:** Vali (V) — klõpsa ja keri ekraani sees · Käsi (H või tühik) — nihuta · Ring (O) — märgi.
- **Suum:** hiireratas või pinch; "Mahuta kõik" (Shift+1).
- **Agendile:** märkused salvestuvad kohe `.canvas/annotations.json`-i. Vajuta "Kopeeri käsk agendile" ja kleebi vestlusesse.

Agendi juhend projekti `CLAUDE.md`-sse: [AGENTS-LOUEND.md](AGENTS-LOUEND.md).

Server kuulab ainult `127.0.0.1` ja keeldub võõra `Origin`/`Host` päisega päringutest.

## Arendus

```sh
npm test
```
