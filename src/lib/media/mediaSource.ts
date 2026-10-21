import {
  downloadMediaMessage,
  type proto,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { unwrapMessageContent } from "@/lib/message/messageContent";

export type MediaKind = "sticker" | "video" | "audio";

/** Command-level ceiling for a conversion; keeps one run from eating the box. */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

/** WhatsApp hands out `a.whatsapp.net`, which does not resolve; the CDN is here. */
const DUMMY_HOST = "a.whatsapp.net";
const MEDIA_HOST = "mmg.whatsapp.net";

interface Hosted {
  url?: unknown;
}

/**
 * The message with any `a.whatsapp.net` media URL rewritten to the real host.
 *
 * Returns a copy: the caller's `WAMessage` is also what Baileys keeps for
 * retries, so rewriting it in place would mutate shared state.
 */
export function withMediaHost(message: WAMessage): WAMessage {
  const content = unwrapMessageContent(message.message);
  if (!content) return message;

  const repaired: Partial<proto.IMessage> = {};
  let changed = content !== message.message;

  for (const [key, value] of Object.entries(content)) {
    const url = (value as Hosted | null)?.url;
    if (typeof url !== "string" || !url.includes(DUMMY_HOST)) continue;

    Object.assign(repaired, {
      [key]: { ...(value as object), url: url.replace(DUMMY_HOST, MEDIA_HOST) },
    });
    changed = true;
  }

  return changed
    ? { ...message, message: { ...content, ...repaired } }
    : message;
}

/** Downloads media bytes, repairing the dummy media host first. */
export async function downloadMedia(message: WAMessage): Promise<Buffer> {
  return downloadMediaMessage(withMediaHost(message), "buffer", {
    host: MEDIA_HOST,
  });
}

export interface ResolvedMediaSource {
  kind: MediaKind;
  message: WAMessage;
  mimetype: string;
  fileLength?: number;
}

export function findMediaSource(
  msg: ParsedMessage,
  allowedKinds: MediaKind[],
): ResolvedMediaSource | null {
  const ownContent = unwrapMessageContent(msg.raw.message);
  const candidates = [
    { content: ownContent, own: true },
    { content: msg.quoted?.content, own: false },
  ];

  for (const { content, own } of candidates) {
    if (!content) continue;
    const message =
      own || !msg.quoted
        ? msg.raw
        : ({ key: msg.quoted.key, message: msg.quoted.content } as WAMessage);

    for (const kind of allowedKinds) {
      const media =
        kind === "sticker"
          ? content.stickerMessage
          : kind === "video"
            ? content.videoMessage
            : content.audioMessage;
      if (!media) continue;

      return {
        kind,
        message,
        mimetype: media.mimetype ?? "",
        ...(media.fileLength !== undefined
          ? { fileLength: Number(media.fileLength) }
          : {}),
      };
    }
  }

  return null;
}
