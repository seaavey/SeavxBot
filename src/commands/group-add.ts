import type { Command } from "@/lib/core/types";
import { runMemberAction } from "@/lib/group/ops";

export const addCommand: Command = {
  name: "add",
  description: "Add members by phone number",
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    await reply(await runMemberAction(sock, msg, "add"));
  },
};

export default addCommand;
