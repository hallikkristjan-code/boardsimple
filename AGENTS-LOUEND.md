# Louend — juhend agendile

Kopeeri see plokk projekti `CLAUDE.md` / `AGENTS.md` faili, kui projektis kasutatakse louendit.

## Ekraanid

- Iga ekraan või variant on üks iseseisev HTML-fail: `screens/<rühm>/<nimi>.html`.
  Rühm = rida lõuendil (nt `screens/suunad/`, `screens/viktoriin/`). Järjekord tuleb
  failinimest, seega nummerda voo sammud: `01-ooteekraan.html`, `02-kusimus.html`.
- Märgi suurus `<head>`-is: `<meta name="artboard" content="width=390,height=844">`
  (mobiil 390, desktop 1440). `height=auto` = sisu kõrgus. Ilma meta-ta: 1440×900.
- Silt lõuendil = `<title>`.
- Üks fail = üks olek. Modaal, tühi olek, viga → eraldi failid.
- Hoia fail iseseisev: CSS `<style>`-is, pildid suhteliste teedega samas kaustas.
  Väliseid serverid/API-sid ei ole.
- Lõuend uueneb ise, kui faili salvestad. Kasutaja käivitab selle: `louend` projekti kaustas.

## Märkused ("vaata märkused üle")

1. Loe `.canvas/annotations.json`. Tööta ainult märkustega, mille `status` on `"open"`.
2. Iga märkus: `file` (milline ekraan), `text` (mida kasutaja tahab), `box` (ringi
   asukoht artboardi pikslites), `elements` (ringi alla jäänud elemendid:
   `selector`, `tag`, `text`, `box`). Kasuta `selector`-it ja `text`-i, et leida
   õige koht failis.
3. Kui `fileHash` ei vasta faili praegusele sisule (sha256), on faili vahepeal
   muudetud — selektor võib olla nihkunud; kontrolli `text`-i järgi.
4. Muuda HTML-faili. Ära loo uut faili, kui märkus ei palu varianti.
5. Pärast muudatust sea selle märkuse `status` väärtuseks `"done"` ja `updatedAt`
   praeguseks ISO-ajaks. Ära kustuta märkusi ega muuda teiste märkuste välju.
6. Kui märkus on ebaselge, jäta see `"open"`-iks ja küsi kasutajalt.
