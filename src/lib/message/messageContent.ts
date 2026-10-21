import {
  extractMessageContent,
  normalizeMessageContent,
  type proto,
} from "@whiskeysockets/baileys";

/**
 * The innermost content of a message. Baileys owns the wrapper rules
 * (ephemeral, view-once, edited, device-sent, document-with-caption), so this
 * only composes its two passes instead of keeping a second list of wrappers.
 */
export function unwrapMessageContent(
  msgContent: proto.IMessage | null | undefined,
): proto.IMessage | undefined {
  return extractMessageContent(normalizeMessageContent(msgContent));
}

export function extractMessageBody(
  content: proto.IMessage | undefined,
): string {
  if (!content) return "";

  // A tapped native-flow button arrives as paramsJson; the "id" field carries
  // whatever the button declared, usually the command it should trigger.
  const flowParams =
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (flowParams) {
    try {
      const parsed = JSON.parse(flowParams) as { id?: unknown };
      if (typeof parsed.id === "string") return parsed.id;
    } catch {
      // Malformed payloads fall through to the regular body extraction.
    }
  }

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.templateButtonReplyMessage?.selectedId ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  );
}

export interface ExtractedCommand {
  prefix: string;
  command: string;
  args: string[];
  text: string;
  isCmd: boolean;
}

export function extractCommand(
  body: string,
  prefixes: string[] = ["!", ".", "#", "/"],
): ExtractedCommand {
  const trimmed = body.trim();
  const prefix = prefixes.find((p) => trimmed.startsWith(p)) || "";
  const isCmd = Boolean(prefix);

  const rawCmd = isCmd ? trimmed.slice(prefix.length).trim() : "";
  const [command = "", ...args] = rawCmd ? rawCmd.split(/\s+/) : [];

  return {
    prefix,
    command: command.toLowerCase(),
    args,
    text: args.join(" "),
    isCmd,
  };
}
