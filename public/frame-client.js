// Screens have a separate origin. Only ask them for page geometry;
// messages from a screen never trigger privileged board actions.
export function requestFrame(iframe, method, params = {}) {
  return new Promise((resolve) => {
    const source = iframe.contentWindow;
    if (!source || iframe.getAttribute("src") === "about:blank") return resolve(null);
    const id = crypto.randomUUID();
    const finish = (value) => { clearTimeout(timer); window.removeEventListener("message", receive); resolve(value); };
    const receive = (event) => {
      if (event.source === source && event.data?.type === "boardsimple:reply" && event.data.id === id) finish(event.data.result);
    };
    const timer = setTimeout(() => finish(null), 1500);
    window.addEventListener("message", receive);
    source.postMessage({ type: "boardsimple:request", id, method, params }, "*");
  });
}
