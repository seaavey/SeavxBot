import { describe, expect, test } from "bun:test";
import { stickerArgs } from "@/lib/media/ffmpeg";

describe("stickerArgs", () => {
  test("builds a still WebP encode with transparent 512px padding", () => {
    expect(
      stickerArgs("input.jpg", "output.webp", {
        animated: false,
        quality: 80,
      }),
    ).toEqual([
      "ffmpeg",
      "-y",
      "-i",
      "input.jpg",
      "-frames:v",
      "1",
      "-vf",
      "format=rgba,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "-c:v",
      "libwebp",
      "-quality",
      "80",
      "-pix_fmt",
      "yuva420p",
      "output.webp",
    ]);
  });

  test("builds an animated WebP encode with the six-second, 15fps limits", () => {
    expect(
      stickerArgs("input.mp4", "output.webp", {
        animated: true,
        quality: 50,
      }),
    ).toEqual([
      "ffmpeg",
      "-y",
      "-i",
      "input.mp4",
      "-t",
      "6",
      "-vf",
      "format=rgba,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15",
      "-c:v",
      "libwebp_anim",
      "-lossless",
      "0",
      "-q:v",
      "50",
      "-loop",
      "0",
      "-an",
      "-pix_fmt",
      "yuva420p",
      "-fps_mode",
      "passthrough",
      "output.webp",
    ]);
  });
});
