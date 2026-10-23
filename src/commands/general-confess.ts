import type { Command } from "@/lib/core/types";
import { deliverConfession } from "@/lib/message/confess";

export const confessCommand: Command = {
  name: "confess",
  description: "Send an anonymous direct message to someone",
  run: async ({ sock, msg, reply }) => {
    const line = await deliverConfession(sock, msg);
    await reply(line);
  },
};

export default confessCommand;
