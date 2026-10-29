/**
 * A puzzle as a short piece of text.
 *
 * `picture-logic.1.5x5.heart` — the module id, a format version, and whatever the module
 * puts in its spec, plus a checksum character. Because a puzzle is regenerated from its
 * spec, the code **is** the puzzle: it can be written on a whiteboard, pasted into a
 * message or seeded from today's date, and no server is involved at any point.
 *
 * The checksum is the part that earns its place. Without one, a mistyped code quietly
 * opens a *different* puzzle, and two children comparing times are comparing nothing. With
 * one, a mistyped code is refused.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstuvwxyz';

/**
 * Position-weighted, so transposing two characters changes the result.
 *
 * A plain sum does not catch a transposition, and transposing two characters is the most
 * common way a person copies a code wrongly.
 */
function checksum(body: string): string {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total = (total + body.charCodeAt(i) * (i + 1)) % ALPHABET.length;
  }
  return ALPHABET[total]!;
}

export function encodeGameId(puzzleId: string, parts: readonly (string | number)[]): string {
  const body = [puzzleId, ...parts.map(String)].join('.');
  return `${body}.${checksum(body)}`;
}

export interface DecodedGameId {
  readonly puzzleId: string;
  readonly parts: readonly string[];
}

/** Null for anything that is not a valid code, including one with a typo in it. */
export function decodeGameId(code: string): DecodedGameId | null {
  const trimmed = code.trim().toLowerCase();
  const cut = trimmed.lastIndexOf('.');
  if (cut <= 0) return null;
  const body = trimmed.slice(0, cut);
  if (checksum(body) !== trimmed.slice(cut + 1)) return null;
  const [puzzleId, ...parts] = body.split('.');
  if (!puzzleId || parts.length === 0) return null;
  return { puzzleId, parts };
}

/**
 * The seed for a given day, in a given place.
 *
 * Local date rather than UTC, deliberately: "today's puzzle" means the day the player is
 * having, and a child in Melbourne being given yesterday's puzzle until mid-morning is a
 * bug report. The cost is that two people in different time zones get different puzzles on
 * the same nominal date, which is the right trade for a toy with no server.
 */
export function dailySeed(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
