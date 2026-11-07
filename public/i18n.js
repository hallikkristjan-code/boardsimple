// UI text in both languages. No DOM access at import time, so the node tests can load this file.
const LANG_KEY = "boardsimple-lang";

export const MESSAGES = {
  et: {
    switchTo: "EN",
    switchToTitle: "Switch to English",
    fit: "Mahuta kõik",
    themeTitle: "Hele / tume",
    themeLabel: "Hele või tume režiim",
    tools: "Tööriistad",
    toolSelect: "Vali",
    toolSelectTitle: "Vali — klõpsa ja keri ekraani sees (V)",
    toolHand: "Käsi",
    toolHandTitle: "Käsi — nihuta lõuendit (H, või hoia tühikut)",
    toolRing: "Ring",
    toolRingTitle: "Ring — märgi, mida muuta (O)",
    toolBox: "Kast",
    toolBoxTitle: "Kast — too blokk täpselt esile (B)",
    toolLine: "Joon",
    toolLineTitle: "Joon — tõmba koha ümber või alla (P)",
    toolArrow: "Nool",
    toolArrowTitle: "Nool — osuta kohale (A)",
    markColor: "Märgi värv",
    red: "Punane",
    orange: "Oranž",
    green: "Roheline",
    blue: "Sinine",
    purple: "Lilla",
    noScreens: "Ekraane pole. Kirjuta HTML-failid kausta <code>screens/</code> (nt <code>screens/suunad/a.html</code>).",
    loadFailed: (msg) => `Ekraanide laadimine ebaõnnestus: ${msg}`,
    screens: (n) => (n === 1 ? "1 ekraan" : `${n} ekraani`),
    connLost: "Ühendus katkes. Käivita boardsimple ja värskenda lehte.",
    connRetry: "Ühendus katkes, vaade võib olla vana. Proovin uuesti…",
    notes: "Märkused",
    notesEmpty: "Vali vasakult tööriist ja märgi koht, mida muuta.",
    emptyNote: "(tühi märkus)",
    pinLabel: (n, text) => `Märkus ${n}: ${text}`,
    noteDeleted: "Märkus kustutatud",
    undo: "Võta tagasi",
    fileChanged: "fail muutunud",
    editText: "muuda tekst",
    reopen: "ava uuesti",
    markDone: "märgi tehtuks",
    remove: "kustuta",
    copy: "Kopeeri käsk agendile",
    copied: "Kopeeritud",
    copyFailed: "Kopeerimine ei õnnestunud",
    agentCommand: (path, origin) => `vaata märkused üle: ${path} (boardsimple: ${origin})`,
    actionFailed: (msg) => `Toiming ebaõnnestus: ${msg}`,
    editFailed: (msg) => `Märkuse muutmine ebaõnnestus: ${msg}`,
    saveFailed: (msg) => `Märkuse salvestamine ebaõnnestus: ${msg}`,
    noteFor: (title) => `Märkus · ${title}`,
    notePrompt: "Mida siin muuta?",
    noteHint: "Enter salvestab · Esc tühistab",
    save: "Salvesta",
  },
  en: {
    switchTo: "ET",
    switchToTitle: "Vaheta eesti keelele",
    fit: "Fit all",
    themeTitle: "Light / dark",
    themeLabel: "Light or dark mode",
    tools: "Tools",
    toolSelect: "Select",
    toolSelectTitle: "Select — click and scroll inside a screen (V)",
    toolHand: "Hand",
    toolHandTitle: "Hand — pan the canvas (H, or hold Space)",
    toolRing: "Ring",
    toolRingTitle: "Ring — mark what to change (O)",
    toolBox: "Box",
    toolBoxTitle: "Box — single out an exact block (B)",
    toolLine: "Line",
    toolLineTitle: "Line — draw around or under a spot (P)",
    toolArrow: "Arrow",
    toolArrowTitle: "Arrow — point at a spot (A)",
    markColor: "Mark color",
    red: "Red",
    orange: "Orange",
    green: "Green",
    blue: "Blue",
    purple: "Purple",
    noScreens: "No screens yet. Write HTML files into <code>screens/</code> (e.g. <code>screens/directions/a.html</code>).",
    loadFailed: (msg) => `Could not load screens: ${msg}`,
    screens: (n) => (n === 1 ? "1 screen" : `${n} screens`),
    connLost: "Connection lost. Start boardsimple and refresh the page.",
    connRetry: "Connection lost, the view may be out of date. Retrying…",
    notes: "Notes",
    notesEmpty: "Pick a tool on the left and mark what to change.",
    emptyNote: "(empty note)",
    pinLabel: (n, text) => `Note ${n}: ${text}`,
    noteDeleted: "Note deleted",
    undo: "Undo",
    fileChanged: "file changed",
    editText: "edit text",
    reopen: "reopen",
    markDone: "mark done",
    remove: "delete",
    copy: "Copy command for agent",
    copied: "Copied",
    copyFailed: "Could not copy",
    agentCommand: (path, origin) => `review the notes: ${path} (boardsimple: ${origin})`,
    actionFailed: (msg) => `Action failed: ${msg}`,
    editFailed: (msg) => `Could not edit the note: ${msg}`,
    saveFailed: (msg) => `Could not save the note: ${msg}`,
    noteFor: (title) => `Note · ${title}`,
    notePrompt: "What should change here?",
    noteHint: "Enter saves · Esc cancels",
    save: "Save",
  },
};

/** The saved choice wins; otherwise Estonian if the browser lists it at all, else English. */
export function pickLang(saved, languages) {
  if (saved in MESSAGES) return saved;
  return languages.some((l) => l.toLowerCase().startsWith("et")) ? "et" : "en";
}

let lang = "et";
const listeners = new Set();

export const onLangChange = (cb) => listeners.add(cb);

export function t(key, ...args) {
  const m = MESSAGES[lang][key];
  return typeof m === "function" ? m(...args) : m;
}

// Text in index.html carries its key in a data attribute. noScreens holds <code>, hence innerHTML;
// it only ever receives strings from MESSAGES above.
function translatePage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}

export function initLang() {
  lang = pickLang(localStorage.getItem(LANG_KEY), navigator.languages);
  translatePage();
  document.getElementById("lang").addEventListener("click", () => {
    lang = lang === "et" ? "en" : "et";
    localStorage.setItem(LANG_KEY, lang);
    translatePage();
    for (const cb of listeners) cb();
  });
}
