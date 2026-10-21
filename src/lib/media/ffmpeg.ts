import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

export interface ConvertOptions {
  timeoutMs?: number;
}

async function convert(
  inputBuffer: Buffer,
  inputExt: string,
  outputExt: string,
  argsForInput: (inputPath: string, outputPath: string) => string[],
  options?: ConvertOptions,
): Promise<Buffer> {
  const id = randomUUID();
  // Distinct suffixes: a same-format conversion (webp → webp) would otherwise
  // hand ffmpeg one path for input and output, which it refuses.
  const inputPath = join(tmpdir(), `seavxbot-${id}-in.${inputExt}`);
  const outputPath = join(tmpdir(), `seavxbot-${id}-out.${outputExt}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let proc: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await Bun.write(inputPath, inputBuffer);
    proc = Bun.spawn(argsForInput(inputPath, outputPath), {
      stdout: "ignore",
      stderr: "ignore",
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc?.kill();
        reject(new Error("FFmpeg conversion timed out"));
      }, options?.timeoutMs ?? 30_000);
    });
    const exitCode = await Promise.race([proc.exited, timeout]);
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    return Buffer.from(await Bun.file(outputPath).arrayBuffer());
  } finally {
    if (timer) clearTimeout(timer);
    await Promise.all(
      [inputPath, outputPath].map(async (path) => {
        try {
          await unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }),
    );
  }
}

const STICKER_SIZE = 512;
const STILL_STICKER_CAP = 100 * 1024;
const ANIMATED_STICKER_CAP = 500 * 1024;
const STILL_STICKER_QUALITIES = [80, 40];
const ANIMATED_STICKER_QUALITIES = [50, 35];
const STICKER_FPS = 15;
const ANIMATED_STICKER_DURATION = 6;

export interface StickerOptions {
  /** Video input: encode an animated WebP. */
  animated: boolean;
  /** Extension of the source bytes; the image2 demuxer needs it, ffmpeg probes the rest. */
  inputExt: string;
}

/** ffmpeg args for one sticker encode; pure so the codec choice is testable. */
export function stickerArgs(
  inputPath: string,
  outputPath: string,
  options: { animated: boolean; quality: number },
): string[] {
  const filter = [
    "format=rgba",
    `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease`,
    `pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
  ];
  if (options.animated) filter.push(`fps=${STICKER_FPS}`);

  return [
    "ffmpeg",
    "-y",
    "-i",
    inputPath,
    ...(options.animated
      ? ["-t", String(ANIMATED_STICKER_DURATION)]
      : ["-frames:v", "1"]),
    "-vf",
    filter.join(","),
    "-c:v",
    options.animated ? "libwebp_anim" : "libwebp",
    ...(options.animated
      ? ["-lossless", "0", "-q:v", String(options.quality), "-loop", "0", "-an"]
      : ["-quality", String(options.quality)]),
    "-pix_fmt",
    "yuva420p",
    ...(options.animated ? ["-fps_mode", "passthrough"] : []),
    outputPath,
  ];
}

export async function toSticker(
  inputBuffer: Buffer,
  options: StickerOptions,
): Promise<Buffer> {
  const qualities = options.animated
    ? ANIMATED_STICKER_QUALITIES
    : STILL_STICKER_QUALITIES;
  const cap = options.animated ? ANIMATED_STICKER_CAP : STILL_STICKER_CAP;
  let result: Buffer | undefined;

  for (const quality of qualities) {
    result = await convert(
      inputBuffer,
      options.inputExt,
      "webp",
      (inputPath, outputPath) =>
        stickerArgs(inputPath, outputPath, {
          animated: options.animated,
          quality,
        }),
    );
    if (result.length <= cap) return result;
  }

  return result!;
}

export function webpToMp4(
  inputBuffer: Buffer,
  options?: ConvertOptions,
): Promise<Buffer> {
  return convert(
    inputBuffer,
    "webp",
    "mp4",
    (inputPath, outputPath) => [
      "ffmpeg",
      "-y",
      "-i",
      inputPath,
      "-movflags",
      "faststart",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-fps_mode",
      "passthrough",
      outputPath,
    ],
    options,
  );
}

export function toMp3(
  inputBuffer: Buffer,
  inputExt = "input",
  options?: ConvertOptions,
): Promise<Buffer> {
  return convert(
    inputBuffer,
    inputExt.replace(/^\./, "") || "input",
    "mp3",
    (inputPath, outputPath) => [
      "ffmpeg",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath,
    ],
    options,
  );
}

export function toImage(
  inputBuffer: Buffer,
  options?: ConvertOptions,
): Promise<Buffer> {
  return convert(
    inputBuffer,
    "webp",
    "png",
    (inputPath, outputPath) => [
      "ffmpeg",
      "-y",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath,
    ],
    options,
  );
}
