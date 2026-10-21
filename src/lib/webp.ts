/** True when the WebP carries the VP8X animation flag; static WebP never does. */
export function isAnimatedWebp(buffer: Buffer): boolean {
  return (
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP" &&
    buffer.toString("latin1", 12, 16) === "VP8X" &&
    ((buffer[20] ?? 0) & 0x02) !== 0
  );
}
