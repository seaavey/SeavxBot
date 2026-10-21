import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/parseMessage";
import { extractFirstUrl } from "@/lib/extractUrl";
import { unwrapMessageContent } from "@/lib/messageContent";

/** Where the image the user pointed at lives. */
export type ImageSource =
  | { kind: "media"; message: WAMessage; mimetype?: string | null }
  | { kind: "url"; url: string };

/**
 * The image the user pointed at: their own, a quoted one, or a link in the
 * text. Null when the message carries none of them.
 */
export function findImageSource(msg: ParsedMessage): ImageSource | null {
  const own = unwrapMessageContent(msg.raw.message)?.imageMessage;
  const quoted = msg.quoted?.content?.imageMessage;
  const image = own ?? quoted;

  if (image) {
    return {
      kind: "media",
      message:
        own || !msg.quoted
          ? msg.raw
          : ({
              key: msg.quoted.key,
              message: msg.quoted.content,
            } as WAMessage),
      mimetype: image.mimetype,
    };
  }

  const url = extractFirstUrl(msg.text);
  return url ? { kind: "url", url } : null;
}

/**
 * WhatsApp media lives behind an encrypted URL, so hand the tool the bytes.
 */
export async function toDataUrl(
  message: WAMessage,
  mimetype?: string | null,
): Promise<string> {
  const content = message.message;
  if (content) {
    for (const key of Object.keys(content)) {
      const val = (content as Record<string, unknown>)[key];
      if (val && typeof val === "object" && "url" in val && typeof val.url === "string") {
        if (val.url.includes("a.whatsapp.net")) {
          val.url = val.url.replace("a.whatsapp.net", "mmg.whatsapp.net");
        }
      }
    }
  }
  const bytes = (await downloadMediaMessage(
    message,
    "buffer",
    { host: "mmg.whatsapp.net" } as unknown as Parameters<typeof downloadMediaMessage>[2],
  )) as Buffer;
  return `data:${mimetype ?? "image/jpeg"};base64,${bytes.toString("base64")}`;
}
