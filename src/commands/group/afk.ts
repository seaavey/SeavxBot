import type { Command } from "@/lib/core/types";
import { applyAfk } from "@/lib/group/afk";

export const afkCommand: Command = {
  name: "afk",
  description: "Mark yourself as away in this group",
  groupOnly: true,
  run: async ({ msg, reply }) => {
    await reply(applyAfk(msg));
  },
};

export default afkCommand;
