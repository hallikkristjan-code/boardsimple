// Runs inside each sandboxed screen. No access to the parent's DOM or APIs.
(() => {
  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function selectorFor(el) {
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "body"; cur = cur.parentElement) {
      const tag = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(`${tag}#${CSS.escape(cur.id)}`); break; }
      const classes = [...cur.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      const same = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : [];
      parts.unshift(tag + classes + (same.length > 1 ? `:nth-of-type(${same.indexOf(cur) + 1})` : ""));
    }
    return parts.join(" > ") || "body";
  }
  function capture({ samples, box }) {
    if (!Array.isArray(samples) || !box) return [];
    const found = new Set();
    for (const p of samples) {
      for (const el of document.elementsFromPoint(p.x, p.y)) {
        if (!["html", "body"].includes(el.tagName.toLowerCase())) found.add(el);
      }
    }
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const hits = [...found].filter((el) => intersects(rectOf(el), box));
    const deepest = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
    deepest.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return deepest.slice(0, 10).map((el) => ({ selector: selectorFor(el), tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80), box: rectOf(el) }));
  }
  window.addEventListener("message", (event) => {
    const request = event.data;
    if (event.source !== parent || request?.type !== "boardsimple:request" || typeof request.id !== "string") return;
    let result = null;
    try {
      if (request.method === "height") result = Math.ceil(document.documentElement.scrollHeight);
      if (request.method === "capture") result = capture(request.params);
    } catch { /* a navigating or malformed screen returns no geometry */ }
    parent.postMessage({ type: "boardsimple:reply", id: request.id, result }, "*");
  });
})();
