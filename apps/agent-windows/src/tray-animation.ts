// The tray icon while the Companion works: the accent chosen in the web travels around the cat's
// white outline, fading back to white behind it. The frames come from the icon's own bitmap: only
// the white outline pixels change color, so the cat and its silhouette stay as they are.

export type ChannelOrder = "bgra" | "rgba";

export type PreparedIcon = {
  width: number;
  height: number;
  order: ChannelOrder;
  base: Uint8Array;
  outline: Array<{ index: number; turn: number; weight: number }>;
};

// Frames per turn around the icon and the time of a full turn (the preview's "Normal").
export const trayFramesPerTurn = 24;
export const trayTurnMs = 1800;
// The comet's tail, as a share of the turn: full accent at its head, white again at its end.
const tail = 0.38;

export function prepareTrayIcon(bitmap: Uint8Array, width: number, height: number, order: ChannelOrder): PreparedIcon {
  const base = Uint8Array.from(bitmap);
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (base[(y * width + x) * 4 + 3] > 24) {
        sx += x;
        sy += y;
        count += 1;
      }
    }
  }
  const cx = count ? sx / count : width / 2;
  const cy = count ? sy / count : height / 2;
  const outline: PreparedIcon["outline"] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = base[index + 3];
      const light = (base[index] + base[index + 1] + base[index + 2]) / 3;
      if (alpha > 0 && light > 150) {
        // Anti-aliased edges, less white, take less of the accent.
        const weight = Math.min(1, (light - 150) / 90);
        const turn = (Math.atan2(y - cy, x - cx) / (Math.PI * 2) + 1) % 1;
        outline.push({ index, turn, weight });
      }
    }
  }
  return { width, height, order, base, outline };
}

export function parseAccent(value: string | null | undefined): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function strength(distance: number): number {
  if (distance > tail) return 0;
  const t = 1 - distance / tail;
  return t * t;
}

// One frame, phase 0..1 being where the comet's head is around the icon.
export function renderTrayFrame(icon: PreparedIcon, phase: number, accent: [number, number, number]): Uint8Array {
  const frame = Uint8Array.from(icon.base);
  const [red, green, blue] = accent;
  const [r, g, b] = icon.order === "bgra" ? [2, 1, 0] : [0, 1, 2];
  for (const pixel of icon.outline) {
    const mix = strength((phase - pixel.turn + 1) % 1) * pixel.weight;
    if (mix <= 0) continue;
    frame[pixel.index + r] = Math.round(frame[pixel.index + r] + (red - frame[pixel.index + r]) * mix);
    frame[pixel.index + g] = Math.round(frame[pixel.index + g] + (green - frame[pixel.index + g]) * mix);
    frame[pixel.index + b] = Math.round(frame[pixel.index + b] + (blue - frame[pixel.index + b]) * mix);
  }
  return frame;
}

export function trayFrames(icon: PreparedIcon, accent: [number, number, number], frames = trayFramesPerTurn): Uint8Array[] {
  return Array.from({ length: frames }, (_value, index) => renderTrayFrame(icon, index / frames, accent));
}

// The agent tells the tray what it is doing with one stdout line; the tray reads it and keeps it out of the log.
export const trayStatusPrefix = "@@videocat-status ";

export type TrayStatus = { busy: boolean; accent: string | null };

export function trayStatusLine(status: TrayStatus): string {
  return `${trayStatusPrefix}${JSON.stringify(status)}`;
}

export function parseTrayStatus(line: string): TrayStatus | null {
  if (!line.startsWith(trayStatusPrefix)) return null;
  try {
    const value = JSON.parse(line.slice(trayStatusPrefix.length)) as Partial<TrayStatus>;
    return { busy: value.busy === true, accent: typeof value.accent === "string" ? value.accent : null };
  } catch {
    return null;
  }
}

// Splits a child's stdout into whole lines across chunks, keeping a partial line for the next chunk.
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    const text = this.rest + chunk.replace(/\r/g, "");
    const lines = text.split("\n");
    this.rest = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    const rest = this.rest;
    this.rest = "";
    return rest ? [rest] : [];
  }
}
