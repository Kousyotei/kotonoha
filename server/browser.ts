import { existsSync } from "node:fs";
// Prefer a locally installed stable Chrome on macOS. The downloaded shell can
// fail to schedule animation frames on some macOS / Chromium combinations.
export function browserExecutable(): string | null {
  if (process.env.REMOTION_BROWSER_EXECUTABLE)
    return process.env.REMOTION_BROWSER_EXECUTABLE;
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return process.platform === "darwin" && existsSync(chrome) ? chrome : null;
}
