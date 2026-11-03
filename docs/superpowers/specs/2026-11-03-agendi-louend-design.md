# Agendi-lõuend (minu-paber) — disain

Kuupäev: 2026-11-03 · Staatus: mustand ülevaatuseks

## Miks

Kasutaja vaatab agentide (Claude Code, Codex) tehtud UI-sid Paperis, sest seal on
mitu ekraani/varianti **kõrvuti ühel lõuendil** (nt dashboardi suunad A/B/C,
viktoriini 9 sammu). Claude'i vestluses on korraga üks eelvaade, võrdlust pole.
Paper on tasuline ja enamikku selle funktsioone ei kasutata. Eesmärk: tasuta
kohalik lõuend, mis teeb ainult seda, mida päriselt kasutatakse — vaata kõrvuti,
märgi ringiga, mis muuta tuleb, ja anna see agendile.

Referents: Paper Desktop 0.5.18 RE (REA, 2026-11-03). Paperis on kohalik MCP
server `127.0.0.1:29979/mcp`, mis toruga kutsub veebiäpi `resolveMCPHandlers`-it;
agent kirjutab HTML-i sõlmedeks. Meie v1 seda ei kopeeri — vt mittesihid.

## Sihid (v1)

1. **Vaata kõrvuti.** Projekti kaustas olevad HTML-ekraanid kuvatakse
   artboardidena ühel lõpmatul lõuendil, nimega ja õiges suuruses.
2. **Rühmad.** Alamkaust = rühm (rida lõuendil), nt `screens/suunad/`,
   `screens/viktoriin/`. Failid rühmas järjestatud nime järgi (`01-…`, `02-…`).
3. **Live.** Kui agent faili lisab/muudab/kustutab, lõuend uueneb ise
   (ilma lehte värskendamata).
4. **Suumi ja nihuta.** Hiireratas/pinch suumib, tühik+lohistamine või käe-tööriist
   nihutab; "mahuta kõik" nupp.
5. **Märgi ringiga.** Ring-tööriist: lohista ellips artboardi peale, avaneb
   väike kast tekstimärkuse jaoks. Märkused nummerdatud, nähtavad lõuendil ja
   parempaneelis; saab kustutada ja muuta.
6. **Agendile.** Märkused salvestuvad kohe `<projekt>/.canvas/annotations.json`-i
   (vt "minu otsused"). Kasutaja ütleb vestluses "vaata märkused üle"; agent loeb faili, teeb
   muudatused HTML-failidesse, lõuend näitab tulemust live.
7. **Märkus on agendile täpne.** Iga märkuse kohta salvestub: artboardi fail,
   ringi kast artboardi pikslites, märkuse tekst, ringi alla jäävad
   elemendid (CSS-selektor, tag, tekstikatke, nende kast), loomise aeg, olek
   (`open` / `done`).
8. **Agendi juhend.** Repos `AGENTS.md`-stiilis lühijuhend (kopeeritav teiste
   projektide `CLAUDE.md`-sse): kuhu ekraanid kirjutada, kuidas suurus märkida,
   kuidas märkusi lugeda ja `done`-iks märkida.

## Mittesihid (v1)

- Lohistamine/elementide liigutamine, teksti otse parandamine (hilisem lisa).
- Disainipaneel, tokenid, kihtide puu, Figma-import, failihaldus, kontod, pilv.
- MCP server ja automaatne agendi-kuulamine (hilisem lisa; v1 = failid).
- Päris töötava äpi ekraanid (URL-artboard) — hilisem lisa; siis märkus ilma
  elementideta, ainult koordinaadid.
- PNG ekraanitõmmised märkustega (vt "minu otsused").

## Anti-sihid (kui see juhtub, on läbi kukkunud)

- Vajab kontot, pilve, tasulist teenust või Paperit.
- Agent ei saa märkusest aru, mida muuta (märkus on ainult pilt/koordinaat).
- Seadistamine on keerulisem kui üks käsk.
- Lõuend on aeglane 20 ekraaniga.

## Piirangud

- Windows 11, Node 24 olemas. Kohalik, ainult `127.0.0.1`.
- Kasutaja ei ole sügav arendaja; vaikimisi peavad töötama ilma valikuteta.
- Kood-minimalism: eelistada stdlib/natiivi, mitte raamistikke.

## Ekraanifaili leping

- Üks ekraan = üks iseseisev `.html` fail `<projekt>/screens/<rühm>/<nimi>.html`
  (ka `screens/<nimi>.html` → rühm "Muu").
- Suurus: `<meta name="artboard" content="width=390,height=844">`; kõrgus võib
  olla `auto` (= sisu kõrgus). Puudumisel 1440×900.
- Silt: `<title>`; puudumisel failinimi.
- Lokaalsed varad (pildid, CSS) suhteliste teedega samast kaustast.

## Minu otsused (kasutaja ei valinud, võib ümber lükata)

- **Tehnika:** üks Node-skript ilma sõltuvusteta: `node canvas.mjs <projekti-kaust>`
  (vaikimisi praegune kaust) → avab brauseri `http://127.0.0.1:<port>`. Server
  serveerib lõuendi lehe JA ekraanid samast päritolust, seega lõuend näeb
  iframe'ide sisse (vajalik ringi-alla-elementide leidmiseks). Live-uuendus:
  `fs.watch` + Server-Sent Events. Lõuendi leht: tavaline HTML/CSS/JS + SVG
  ülekiht märkustele.
- **Artboard = iframe** (ekraani stiilid ei leki lõuendile). Suumimine CSS
  `transform`-iga konteineril.
- **PNG-d jäävad v1-st välja.** Brauseris iframe'i pildistamine vajaks teeki;
  agendile piisab selektorist + tekstist + kastist, ja agent saab vajadusel ise
  HTML-i renderdada. (Varem vestluses mainitud PNG-d → nüüd hilisem lisa.)
- **Märkuste olek** säilib failis; lõuend loeb `annotations.json` käivitusel ja
  failimuudatusel (nii näeb kasutaja, kui agent märkis `done`).
- Asukoht: see repo `C:\Arendus\minu-paber`; teised projektid kasutavad seda
  käsuga, mitte koopiaga.

- **Märkus on hetktõmmis.** Ring, selektorid ja elementide tekst salvestuvad
  loomise hetke seisuna (koos faili sisu räsiga). Kui agent faili muudab, jääb
  ring algsele kohale; kui räsi erineb, näitab lõuend märkusel "fail muutunud".
  Re-ankurdamist v1-s pole. `done` märgib agent; kasutaja saab märkuse
  paneelist uuesti `open`-iks teha.
- **Salvestus on kohene.** Iga märkuse lisamine/muutmine/kustutamine läheb kohe
  serverisse (POST/PATCH/DELETE ühe märkuse kaupa, unikaalne `id`). Server
  hoiab `annotations.json`-it ja ühendab muudatused märkuse `id` järgi (viimane
  kirjutus võidab sama märkuse piires), seega agendi `done` ja kasutaja uus
  märkus ei kirjuta üksteist üle. Maketi nupp "Salvesta agendile" asendub
  paneeli allservas reaga "N avatud märkust · .canvas/annotations.json" ja
  nupuga "Kopeeri käsk agendile" (kopeerib "vaata märkused üle: <tee>").
- **Ekraanid on vaikimisi passiivsed.** Ringi- ja käe-tööriistaga katab
  iframe'e läbipaistev kiht (klõpsud ei jõua ekraanini). Vali-tööriistaga saab
  artboardi sees klõpsida ja kerida (nt prototüübi nupud). Ringi alla jäävad
  elemendid leitakse iframe'i `elementsFromPoint`-iga ringi kasti
  punktivõrgult, arvestades suumi.
- **Ekraanid eeldatakse staatilisteks** (skriptid lubatud, aga märkus salvestab
  laadimisjärgse seisu). Mitu olekut = mitu faili (nagu viktoriini sammud).
- **Käivitus:** `package.json` `bin` → `npm link` annab käsu `louend`
  (`louend` = praegune kaust, `louend <kaust>`). Agendi juhend kasutab seda käsku.
- **Maketi paigutus:** vasakul kitsas tööriistariba (vali, käsi, ring), keskel
  ruudustikuga lõuend, rühma nimi suurtähtedes rea kohal, artboardi silt
  artboardi kohal; paremal ~170 px märkuste paneel (punane number + tekst +
  "fail · element"); üleval projekti nimi ja suumi protsent. Ringid punased
  (#ff3b30) numbrimärgiga.

## Ehitaja otsustada

- Täpne JSON-kuju (järgides sihti 7), pordi valik, UI detailid maketi vaimus
  (vasakul tööriistad: vali, käsi, ring; paremal märkuste paneel; üleval
  projekti nimi ja suum).
- Testimisviis (eelistada skripti/teste serveri ja märkuse-arvutuse jaoks).

## Edu

Kasutaja avab toitumisnõustaja kolm suunda ja viktoriini sammud ühel
lõuendil, tõmbab kaks ringi, vajutab "Salvesta agendile", ütleb Claude'ile
"vaata märkused üle" ja näeb paranduse lõuendil ilmuvat — ilma Paperita.
