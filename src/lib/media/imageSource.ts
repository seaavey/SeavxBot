import type { WAMessage } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { extractFirstUrl } from "@/lib/media/extractUrl";
import { downloadMedia } from "@/lib/media/mediaSource";
import { unwrapMessageContent } from "@/lib/message/messageContent";

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
 * The host repair lives in `downloadMedia`, the single download path.
 */
export async function toDataUrl(
  message: WAMessage,
  mimetype?: string | null,
): Promise<string> {
  const bytes = await downloadMedia(message);
  return `data:${mimetype ?? "image/jpeg"};base64,${bytes.toString("base64")}`;
}
