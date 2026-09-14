import fs from "node:fs";
import path from "node:path";
import pngjs from "pngjs";

const { PNG } = pngjs;
const agentRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(agentRoot, "../..");
const sourcePath = path.join(repositoryRoot, "logo.png");
const outputPath = path.join(agentRoot, "build", "icon.png");

function slidingMaximum(values, length, radius) {
  const result = new Float32Array(length);
  const deque = new Int32Array(length);
  let head = 0;
  let tail = 0;
  let next = 0;

  for (let index = 0; index < length; index += 1) {
    const right = Math.min(length - 1, index + radius);
    while (next <= right) {
      while (tail > head && values[deque[tail - 1]] <= values[next]) tail -= 1;
      deque[tail] = next;
      tail += 1;
      next += 1;
    }

    const left = index - radius;
    while (tail > head && deque[head] < left) head += 1;
    result[index] = values[deque[head]];
  }

  return result;
}

function dilate(source, width, height, radius) {
  const horizontal = new Float32Array(source.length);
  const row = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    row.set(source.subarray(offset, offset + width));
    horizontal.set(slidingMaximum(row, width, radius), offset);
  }

  const output = new Float32Array(source.length);
  const column = new Float32Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = horizontal[y * width + x];
    const maximum = slidingMaximum(column, height, radius);
    for (let y = 0; y < height; y += 1) output[y * width + x] = maximum[y];
  }
  return output;
}

function boxBlur(source, width, height, radius) {
  const horizontal = new Float32Array(source.length);
  const rowPrefix = new Float64Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    rowPrefix[0] = 0;
    for (let x = 0; x < width; x += 1) {
      rowPrefix[x + 1] = rowPrefix[x] + source[y * width + x];
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      horizontal[y * width + x] = (rowPrefix[right + 1] - rowPrefix[left]) / (right - left + 1);
    }
  }

  const output = new Float32Array(source.length);
  const columnPrefix = new Float64Array(height + 1);
  for (let x = 0; x < width; x += 1) {
    columnPrefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      columnPrefix[y + 1] = columnPrefix[y] + horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      output[y * width + x] = (columnPrefix[bottom + 1] - columnPrefix[top]) / (bottom - top + 1);
    }
  }
  return output;
}

if (!fs.existsSync(sourcePath)) throw new Error(`Source icon not found: ${sourcePath}`);

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const alpha = new Float32Array(source.width * source.height);
for (let pixel = 0; pixel < alpha.length; pixel += 1) {
  alpha[pixel] = source.data[pixel * 4 + 3] / 255;
}

const outline = dilate(alpha, source.width, source.height, 52);
let glow = outline;
for (const radius of [30, 30, 30]) glow = boxBlur(glow, source.width, source.height, radius);

const output = new PNG({ width: source.width, height: source.height });
for (let pixel = 0; pixel < alpha.length; pixel += 1) {
  const sourceAlpha = alpha[pixel];
  const outlineAlpha = Math.max(0, outline[pixel] - sourceAlpha) * 0.98;
  const glowAlpha = glow[pixel] * (1 - outline[pixel]) * 0.72;
  const whiteAlpha = Math.min(1, Math.max(outlineAlpha, glowAlpha));
  const outputAlpha = sourceAlpha + whiteAlpha * (1 - sourceAlpha);
  const whiteContribution = whiteAlpha * (1 - sourceAlpha);
  const channel = outputAlpha > 0 ? Math.round(255 * whiteContribution / outputAlpha) : 0;
  const offset = pixel * 4;
  output.data[offset] = channel;
  output.data[offset + 1] = channel;
  output.data[offset + 2] = channel;
  output.data[offset + 3] = Math.round(outputAlpha * 255);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(output, { colorType: 6, inputColorType: 6 }));
console.log(`Generated Windows icon with compact white glow: ${outputPath}`);
