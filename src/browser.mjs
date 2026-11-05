import { existsSync } from "node:fs";
import { homedir } from "node:os";
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

export const DEFAULT_PROFILE_DIR = join(homedir(), ".boardsimple", "chrome-profile");

// Own profile: the window is independent of the user's running browser
// (always its own process and taskbar entry) and remembers its own size and
// position. The size flag is only given on the first launch; after that the
// profile's remembered bounds win.
export function openCommand(url, opts = {}) {
  const browser = findAppBrowser(opts);
  if (browser) {
    const { profileDir = DEFAULT_PROFILE_DIR, exists = existsSync } = opts;
    const args = [`--app=${url}`, `--user-data-dir=${profileDir}`, "--new-window", "--no-first-run", "--no-default-browser-check"];
    if (!exists(profileDir)) args.push("--window-size=1400,900");
    return [browser, args];
  }
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}
