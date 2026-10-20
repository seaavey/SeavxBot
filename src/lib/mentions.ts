// Indonesian mobile numbers, optionally +62-prefixed or 0-prefixed. A number
// already tagged (@…) and one inside a path (wa.me/…) are left alone.
const PHONE = /(?<![@/\w])\+?(?:62|0)8\d{7,11}\b/g;

export interface MentionedText {
  text: string;
  mentions?: string[];
}

/** Rewrites every phone number in a reply into an @tag plus its mention JID. */
export function mentionPhones(text: string): MentionedText {
  const mentions: string[] = [];

  const body = text.replace(PHONE, (raw) => {
    const digits = raw.replace(/\D/g, "");
    const number = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
    const jid = `${number}@s.whatsapp.net`;

    if (!mentions.includes(jid)) mentions.push(jid);
    return `@${number}`;
  });

  return mentions.length > 0 ? { text: body, mentions } : { text: body };
}
