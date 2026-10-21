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
  const inputPath = join(tmpdir(), `seavxbot-${id}.${inputExt}`);
  const outputPath = join(tmpdir(), `seavxbot-${id}.${outputExt}`);
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
    await Promise.all([inputPath, outputPath].map(async (path) => {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }));
  }
}

export function webpToMp4(inputBuffer: Buffer, options?: ConvertOptions): Promise<Buffer> {
  return convert(inputBuffer, "webp", "mp4", (inputPath, outputPath) => [
    "ffmpeg", "-y", "-i", inputPath, "-movflags", "faststart", "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-fps_mode", "passthrough", outputPath,
  ], options);
}

export function toMp3(inputBuffer: Buffer, inputExt = "input", options?: ConvertOptions): Promise<Buffer> {
  return convert(inputBuffer, inputExt.replace(/^\./, "") || "input", "mp3", (inputPath, outputPath) => [
    "ffmpeg", "-y", "-i", inputPath, "-vn", "-c:a", "libmp3lame", "-q:a", "2", outputPath,
  ], options);
}

export function toImage(inputBuffer: Buffer, options?: ConvertOptions): Promise<Buffer> {
  return convert(inputBuffer, "webp", "png", (inputPath, outputPath) => [
    "ffmpeg", "-y", "-i", inputPath, "-frames:v", "1", "-update", "1", outputPath,
  ], options);
}
