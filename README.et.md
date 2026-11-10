<img src="assets/icon.svg" width="64" height="64" alt="">

# BoardSimple

[In English](README.md)

Lihtne tasuta tahvel koodiagentide loodud kasutajaliidestele tagasiside andmiseks.

Kui sul pole vaja kõiki Paperi pakutavaid tööriistu, aga tahaksid lihtsat tahvlit agendi
pakutud UI-de ülevaatamiseks, on BoardSimple kerge võimalus. Vaata HTML-ekraane kõrvuti,
märgi, mida muuta, ja lase agendil tagasiside kohalikust failist lugeda. Kontot ega
tellimust pole vaja.

![Kolm UI suunda BoardSimple'is koos agendile mõeldud märkusega](assets/demo.png)

BoardSimple on varajases järgus kohalik tööriist. See kasutab agendi loodud HTML-faile;
töötava rakenduse URL-i manustada ei saa. Tegemist on iseseisva projektiga, mis pole
Paperiga seotud.

## Paigaldus

Vajab Node.js 24+. Npm-sõltuvusi pole.

```sh
npm install -g boardsimple
```

Või käivita üks kord ilma paigaldamata, oma projekti kaustas:

```sh
npx boardsimple
```

Hoia terminal tahvli kasutamise ajal töös; serveri peatamiseks vajuta Ctrl+C.
Kui PowerShell blokeerib npm-skriptid, kasuta Windowsis `npm.cmd`, `npx.cmd` ja `boardsimple.cmd`.

Demo on selles repos. Selle proovimiseks on vaja ka Giti:

```sh
git clone https://github.com/hallikkristjan-code/boardsimple.git
cd boardsimple
boardsimple examples/demo
```

## Anna agendile tagasisidet

1. Palu koodiagendil luua iseseisvad HTML-ekraanid projekti `screens/` kausta.
   Kopeeri [agendi juhend](AGENTS-BOARDSIMPLE.md) projekti `AGENTS.md` või `CLAUDE.md` faili.
2. Käivita ülemkaustas `boardsimple ./minu-projekt` või projekti sees `boardsimple`.
3. Võrdle ekraane, joonista ring, kast, joon või nool ning kirjuta, mida muuta.
4. Vali **Agendiühendus** alt T3 Code, Claude Code või Codex ja vajuta **Saada agendile**.
   Võid ka vajutada **Kopeeri käsk agendile** ja kleepida käsu agendi vestlusesse.
5. Agent loeb `.canvas/annotations.json` faili ja muudab HTML-i. Tahvel uueneb automaatselt.

Märkused jäävad projekti `.canvas/` kausta. Kaasa see varukoopiatesse; kui tagasiside on
privaatne, lisa kaust projekti `.gitignore` faili. BoardSimple salvestab tagasiside
kohalikult; laaditavad HTML-ekraanid võivad siiski küsida väliseid ressursse.

### Saada otse agendile

Ava märkuste paneelis **Agendiühendus**. **T3 Code'i** või **Codexi** jaoks sisesta selle projekti
vestluse ID ja salvesta ühendus. Kui ID-d ei leia, küsi seda agendilt; kui agent käivitas
BoardSimple'i, võib tema vestluse ID olla juba sisestatud. Valik jääb selle projekti jaoks meelde
failis `.canvas/agent.json`.

T3 Code peab selles arvutis töötama ja selle `t3 thread send` käsk peab olema saadaval.
Codex peab olema paigaldatud ja sisse logitud ning toetama käsku
`codex queue --thread ... --message ... --resume`. Kui vanemas versioonis need käsud puuduvad,
uuenda agendirakendust või kasuta kopeerimisnuppu.

**Claude Code'i** jaoks käivita tahvel ja sellega ühendatud interaktiivne sessioon koos:

```sh
boardsimple ./minu-projekt --claude
# Kindla vestluse jätkamiseks välju sellest esmalt teises terminalis:
boardsimple ./minu-projekt --claude --claude-session <sessiooni-id>
```

Kinnita Claude'is BoardSimple'i MCP-server ja arenduskanal, seejärel vali tahvlil **Claude Code**
ja salvesta ühendus. Kanal viib sellesse avatud sessiooni; eraldi API-võtit pole vaja.
Kohandatud kanalid vajavad praegu Claude'i arenduskanali kinnitamist ja kanalit lubavat kontot
või organisatsiooni. Agendi loaküsimused ilmuvad endiselt Claude'is. Ühendatud Claude'i sessiooni
sulgemine peatab ka selle BoardSimple'i serveri.

**Saada agendile** palub valitud vestluses avatud märkused kohe teostada. Hõivatud agent võib need
järjekorda panna. Igal saatmisel salvestub koopia `.canvas/feedback-<id>.json`, mistõttu hilisem
muutmine ei muuda saadetud ülesannet. Saatmiskinnitus tähendab jõudmist agendi järjekorda või
kanalisse; töö edenemist ja loaküsimusi näed agendi vestluses. Saatmine ise ei märgi märkusi
tehtuks, ei tee commit'i ega avalda midagi. Kopeerimisnupp jääb alles.

## Kasutus

```sh
boardsimple                 # praegune kaust
boardsimple ./minu-projekt
boardsimple --port 5000 --no-open
```

Lõuend avaneb eraldi aknas (Chrome, Edge, Chromium või Brave `--app`-režiimis): oma taskbar-kirje,
Alt+Tab-is nähtav, tabide vahele ei kao. Aknal on oma profiil (`~/.boardsimple/chrome-profile`), nii et suurus ja
asukoht jäävad meelde. Mujalt klikitud lõuendi link jõuab tavatabi, mis annab töö sellele aknale üle ja sulgeb end.
Kui ühtki neist pole, avaneb tavabrauseris.

Proovi repo kloonis demoga: `boardsimple examples/demo` (inglise keeles `examples/demo-en`).

- **Ekraanid:** `screens/<rühm>/<nimi>.html`, suurus `<meta name="artboard" content="width=390,height=844">`.
- **Tööriistad:** Vali (V) — klõpsa ja keri ekraani sees · Käsi (H või tühik) — nihuta · Ring (O), Kast (B), Joon (P), Nool (A) — märgi. Joon sulgub, kui lõpetad alguse lähedal; muidu jääb allakriipsutuseks. Värv kehtib järgmistele märkidele.
- **Suum:** hiireratas või pinch; "Mahuta kõik" (Shift+1).
- **Agendile:** märkused salvestuvad kohe `.canvas/annotations.json`-i; kustutatud märkuse saab mõne sekundi jooksul tagasi võtta. Ühenda agent ja saada avatud märkused või kopeeri käsk vestlusesse.
- **Keel:** äpp järgib brauserit (eesti keel, kui see on loetelus, muidu inglise). ET/EN nupp teema nupu kõrval vahetab keelt ja jätab valiku meelde. Käsurida järgib süsteemi keelt; `BOARDSIMPLE_LANG=et` või `en` kirjutab selle üle.
- **Tõrkeotsing:** kui GPU protsess kukub või lähtestub, tekib rida faili `.canvas/client.log`. Puuduvaid graafikatükke see ei märka.

Agendi juhend projekti `CLAUDE.md`-sse: [AGENTS-BOARDSIMPLE.md](AGENTS-BOARDSIMPLE.md) ([in English](AGENTS-BOARDSIMPLE.en.md)).

Server kuulab ainult `127.0.0.1` ja keeldub võõra `Origin`/`Host` päisega päringutest.
Ekraanid töötavad eraldi kohaliku, ainult lugemiseks mõeldud aadressi sandbox-raamides: nende
skriptid, kohalikud moodulid ja fondid töötavad, kuid ei pääse tahvli DOM-i ega agendinuppude juurde.
Ekraani brauserisalvestus kuulub sellele eraldi aadressile. Mõõtmed ja märgitud elemendid liiguvad piiratud sõnumiliidese kaudu.

## Arendus

```sh
npm test                      # node-testid
python -I test/e2e/e2e.py     # brauseri e2e (pip install playwright && playwright install chromium)
python -I test/e2e/marks.py   # märkimise tööriistad ja värvid
python -I test/e2e/agents.py  # agendivalik, saatmisolekud ja ühendamine
python -I test/e2e/a11y.py    # klaviatuur, tagasivõtt ja kontrast
python -I test/e2e/touch.py   # üks ja kaks sõrme, kitsas aken
python -I test/e2e/window.py  # üleandmine tabist app-aknale
python -I test/e2e/load.py    # 146 lehe koormusproov; BOARDSIMPLE_E2E_GPU=1 lisab Windowsil GPU mälu piiri
```

CI jooksutab kõik (node-testid Ubuntul ja Windowsil, e2e ja koormusproov Ubuntul). GPU piiri CI ei kontrolli, sest seal pole päris GPU-d.

## Litsents

[MIT](LICENSE). Tasuta kasutamiseks, muutmiseks ja jagamiseks.
