import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/parseMessage";
import { unwrapMessageContent } from "@/lib/messageContent";

export type MediaKind = "sticker" | "video" | "audio";

export interface ResolvedMediaSource {
  kind: MediaKind;
  message: WAMessage;
  mimetype: string;
  fileLength?: number;
}

/**
 * Downloads media safely from WhatsApp, repairing dummy hostnames like a.whatsapp.net
 * which do not resolve in DNS to the real Meta Media Gateway (mmg.whatsapp.net).
 */
export async function downloadMedia(message: WAMessage): Promise<Buffer> {
  const content = message.message;
  if (content) {
    for (const key of Object.keys(content)) {
      const val = (content as Record<string, unknown>)[key];
      if (
        val &&
        typeof val === "object" &&
        "url" in val &&
        typeof val.url === "string"
      ) {
        if (val.url.includes("a.whatsapp.net")) {
          val.url = val.url.replace("a.whatsapp.net", "mmg.whatsapp.net");
        }
      }
    }
  }

  // Cast options to include host override supported by Baileys messages-media
  return (await downloadMediaMessage(message, "buffer", {
    host: "mmg.whatsapp.net",
  } as unknown as Parameters<typeof downloadMediaMessage>[2])) as Buffer;
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
