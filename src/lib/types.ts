import type {
  WASocket,
  AnyMessageContent,
  MiscMessageGenerationOptions,
} from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/parseMessage";

export interface CommandContext {
  sock: WASocket;
  msg: ParsedMessage;
  reply: (
    content: string | AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ) => Promise<unknown>;
  /** Reacts to the invoking message; failures are ignored because it is cosmetic. */
  react: (text: string) => Promise<unknown>;
}

export interface Command {
  name: string;
  description?: string;
  aliases?: string[];
  ownerOnly?: boolean;
  adminOnly?: boolean;
  groupOnly?: boolean;
  botAdminOnly?: boolean;
  run: (ctx: CommandContext) => Promise<void> | void;
}
