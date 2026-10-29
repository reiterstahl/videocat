import { resolveTrayLanguage, translateTray, type TrayLanguage } from "./tray-i18n.js";

// The agent's log lines in the Companion's language. The tray passes the one it shows as
// VIDEOCAT_LANGUAGE; run on its own, the agent follows COMPANION_LANGUAGE or the system's.
export function agentLanguage(): TrayLanguage {
  return resolveTrayLanguage(process.env.VIDEOCAT_LANGUAGE ?? process.env.COMPANION_LANGUAGE, [Intl.DateTimeFormat().resolvedOptions().locale]);
}

export function tl(text: string, values?: Record<string, string | number>): string {
  return translateTray(text, agentLanguage(), values);
}
