/** The one bit of syntax in quick input: "@list" as the first or last word adds the rest to that list. */

export interface ListRef {
  id: string;
  name: string;
}

export interface QuickInput {
  text: string;
  /** Set when the input names an existing list; the text then goes on that list instead of printing. */
  list?: ListRef;
}

export function listKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Matches "@groc" to a list exactly, or by a prefix only one list has. */
export function findList(token: string, lists: readonly ListRef[]): ListRef | undefined {
  if (!/^@\S+$/.test(token)) return undefined;
  const wanted = listKey(token.slice(1));
  if (!wanted) return undefined;
  const exact = lists.filter((list) => listKey(list.name) === wanted);
  if (exact.length === 1) return exact[0];
  const prefixed = lists.filter((list) => listKey(list.name).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export function parseQuickInput(raw: string, lists: readonly ListRef[]): QuickInput {
  const text = raw.trim().replace(/\s+/g, " ");
  const words = text.split(" ");
  if (words.length < 2 || lists.length === 0) return { text };
  const first = findList(words[0], lists);
  if (first) return { text: words.slice(1).join(" "), list: first };
  const last = findList(words[words.length - 1], lists);
  if (last) return { text: words.slice(0, -1).join(" "), list: last };
  return { text };
}
