import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

// Chromium-based browsers in preference order. Each supports `--app=URL`,
// which opens the page in its own window: no tabs, no address bar, own
// taskbar entry. That is all the "native shell" the canvas needs.
function candidates(platform, env) {
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    const rel = [
      ["Google", "Chrome", "Application", "chrome.exe"],
      ["Microsoft", "Edge", "Application", "msedge.exe"],
      ["Chromium", "Application", "chrome.exe"],
      ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
    ];
    return rel.flatMap((parts) => roots.map((r) => join(r, ...parts)));
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const names = ["google-chrome", "google-chrome-stable", "microsoft-edge", "chromium", "chromium-browser", "brave-browser"];
  return names.flatMap((n) => dirs.map((d) => join(d, n)));
}

export function findAppBrowser({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  return candidates(platform, env).find((p) => exists(p)) ?? null;
}

export function openCommand(url, opts = {}) {
  const browser = findAppBrowser(opts);
  if (browser) return [browser, [`--app=${url}`, "--new-window", "--no-first-run", "--no-default-browser-check"]];
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}
