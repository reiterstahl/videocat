// Seeds a deterministic demo catalog for local development and end-to-end tests.
// It deletes every catalogued disk, file and thumbnail first, so it refuses to run unless explicitly enabled.
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import jpeg from "jpeg-js";

if (process.env.NODE_ENV === "production") {
  console.error("seed-demo refuses to run with NODE_ENV=production.");
  process.exit(1);
}
if (process.env.VIDEOCAT_DEMO_SEED !== "1") {
  console.error("Set VIDEOCAT_DEMO_SEED=1 to confirm: this replaces the whole catalog with demo data.");
  process.exit(1);
}

const thumbnailsDir = process.env.THUMBNAILS_DIR;
if (!thumbnailsDir) {
  console.error("THUMBNAILS_DIR is required.");
  process.exit(1);
}

const prisma = new PrismaClient();
const frameCount = 15;
const gigabyte = 1_000_000_000;

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const next = random(20261001);
const pick = <T,>(items: T[]): T => items[Math.floor(next() * items.length)];

const disks = [
  { name: "WD Elements", driveLetter: "E:", totalBytes: 4_000 * gigabyte, freeBytes: 1_160 * gigabyte },
  { name: "LaCie Rugged", driveLetter: "F:", totalBytes: 5_000 * gigabyte, freeBytes: 600 * gigabyte },
  { name: "Seagate Expansion", driveLetter: "G:", totalBytes: 2_000 * gigabyte, freeBytes: 920 * gigabyte },
  { name: "Toshiba Canvio", driveLetter: null, totalBytes: 1_000 * gigabyte, freeBytes: 70 * gigabyte },
  { name: "Samsung T7", driveLetter: null, totalBytes: 500 * gigabyte, freeBytes: 300 * gigabyte }
];

const names = [
  "Vacaciones_Guanacaste", "Cumpleanos_Mateo", "Concierto_Teatro_Nacional", "Drone_Arenal_amanecer",
  "Boda_Ana_Luis_ceremonia", "Tutorial_edicion", "Playa_Tamarindo_GoPro", "Entrevista_Proyecto_Cafe",
  "Graduacion_Sofia", "Timelapse_Irazu_nubes", "Navidad_abuelos_VHS", "Partido_final_colegio",
  "Paseo_Monteverde", "Clase_fotografia", "Reunion_familiar", "Pruebas_camara_4K"
];
const folders = ["Familia/2019/Viajes", "Familia/2021", "Eventos/2018", "Drone/2022", "Eventos/2020/Boda", "Cursos", "Trabajo/Documental", "Digitalizado/VHS"];
const resolutions: Array<[number, number]> = [[3840, 2160], [1920, 1080], [2720, 1530], [1280, 720], [720, 480]];
const extensions = ["mp4", "mkv", "mov", "webm", "avi"];
const categories = ["keep", "review", "delete", "sh", null, null, null];
const palettes: Array<[[number, number, number], [number, number, number]]> = [
  [[75, 127, 145], [16, 38, 47]], [[154, 107, 67], [42, 26, 14]], [[101, 82, 160], [20, 15, 42]],
  [[78, 145, 115], [15, 39, 28]], [[154, 75, 99], [42, 16, 23]], [[54, 133, 170], [11, 32, 44]],
  [[140, 116, 51], [33, 27, 9]], [[86, 112, 154], [17, 26, 39]]
];

function frameImage(palette: (typeof palettes)[number], frame: number): Buffer {
  const width = 320;
  const height = 180;
  const data = Buffer.alloc(width * height * 4);
  const [top, bottom] = palette;
  const horizon = Math.round(height * (0.5 + 0.12 * Math.sin(frame / 2)));
  const sunX = Math.round((frame / frameCount) * width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = y / height;
      let color = top.map((value, index) => Math.round(value * (1 - t) + bottom[index] * t));
      if (y > horizon) color = color.map((value) => Math.round(value * 0.45));
      const dx = (x - sunX) / 34;
      const dy = (y - horizon) / 18;
      if (dx * dx + dy * dy < 1) color = color.map((value) => Math.min(255, value + 70));
      const offset = (y * width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 75).data;
}

async function writeFrames(diskId: string, fileId: string, palette: (typeof palettes)[number], durationSeconds: number) {
  const directory = path.join(thumbnailsDir!, diskId, fileId);
  await fs.mkdir(directory, { recursive: true });
  const rows = [];
  for (let frame = 1; frame <= frameCount; frame += 1) {
    const kind = `frame_${String(frame).padStart(2, "0")}`;
    await fs.writeFile(path.join(directory, `${kind}.jpg`), frameImage(palette, frame));
    rows.push({ videoFileId: fileId, kind, timestampSeconds: (durationSeconds * frame) / (frameCount + 1), relativePath: `${diskId}/${fileId}/${kind}.jpg` });
  }
  await prisma.thumbnail.createMany({ data: rows });
}

async function main() {
  await prisma.$transaction([
    prisma.downloadQueue.deleteMany(),
    prisma.thumbnail.deleteMany(),
    prisma.videoFileCategory.deleteMany(),
    prisma.videoFile.deleteMany(),
    prisma.disk.deleteMany()
  ]);
  await fs.rm(thumbnailsDir!, { recursive: true, force: true });
  await fs.mkdir(thumbnailsDir!, { recursive: true });

  const createdDisks = [];
  for (const disk of disks) {
    createdDisks.push(await prisma.disk.create({
      data: { ...disk, totalBytes: BigInt(disk.totalBytes), freeBytes: BigInt(disk.freeBytes) }
    }));
  }

  const originals = [];
  for (let index = 0; index < 64; index += 1) {
    const disk = createdDisks[index % createdDisks.length];
    const base = `${names[index % names.length]}_${String(index).padStart(2, "0")}`;
    const extension = pick(extensions);
    const folder = pick(folders);
    const [width, height] = pick(resolutions);
    const sizeBytes = Math.round((0.3 + next() * 29) * gigabyte);
    const durationSeconds = Math.round(90 + next() * 5900);
    const category = pick(categories);
    const relativePath = `${folder}/${base}.${extension}`;
    const file = await prisma.videoFile.create({
      data: {
        diskId: disk.id,
        filename: `${base}.${extension}`,
        extension,
        absolutePath: `X:/${relativePath}`,
        relativePath,
        sizeBytes: BigInt(sizeBytes),
        folderSizeBytes: BigInt(sizeBytes * (3 + Math.floor(next() * 15))),
        scanStatus: "done",
        durationSeconds,
        width,
        height,
        videoCodec: "h264",
        audioCodec: "aac",
        bitrate: BigInt(Math.round((sizeBytes * 8) / durationSeconds)),
        curationStatus: category ?? "none",
        reviewedAt: category === "keep" || category === "delete" ? new Date() : null,
        modifiedAt: new Date(Date.now() - Math.floor(next() * 900) * 86_400_000)
      }
    });
    if (category) await prisma.videoFileCategory.create({ data: { videoFileId: file.id, categoryKey: category } });
    const palette = palettes[index % palettes.length];
    await writeFrames(disk.id, file.id, palette, durationSeconds);
    originals.push({ file, palette, sizeBytes, durationSeconds, width, height });
  }

  // Eight duplicate groups: same size on another drive, some with a lower resolution copy.
  for (let index = 0; index < 8; index += 1) {
    const original = originals[index * 7];
    const copies = index % 3 === 0 ? 2 : 1;
    for (let copy = 0; copy < copies; copy += 1) {
      const disk = createdDisks[(createdDisks.findIndex((item) => item.id === original.file.diskId) + 1 + copy) % createdDisks.length];
      const base = original.file.filename.replace(/\.[^.]+$/, "");
      const filename = `${base} (copia${copy === 0 ? "" : " 2"}).mp4`;
      const relativePath = `Varios/Exportados/${filename}`;
      const lowerResolution = (index + copy) % 2 === 0;
      const file = await prisma.videoFile.create({
        data: {
          diskId: disk.id,
          filename,
          extension: "mp4",
          absolutePath: `X:/${relativePath}`,
          relativePath,
          sizeBytes: BigInt(original.sizeBytes),
          scanStatus: "done",
          durationSeconds: original.durationSeconds + (copy ? 0.4 : 0),
          width: lowerResolution ? 1920 : original.width,
          height: lowerResolution ? 1080 : original.height,
          videoCodec: "h264",
          audioCodec: "aac",
          curationStatus: "none",
          modifiedAt: new Date()
        }
      });
      await writeFrames(disk.id, file.id, original.palette, original.durationSeconds);
    }
  }

  const count = await prisma.videoFile.count();
  console.log(`Demo catalog ready: ${createdDisks.length} disks, ${count} videos, thumbnails in ${thumbnailsDir}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
