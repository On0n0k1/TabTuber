/*
 * Persisted user settings (SPEC.md section 9).
 *
 * Deliberately tiny. Every accessor is wrapped, because localStorage throws
 * rather than returning null in a private window or with site data blocked,
 * and a thrown setting must not take the whole app down with it. A missing or
 * unreadable value always falls back to the caller's default.
 */

/*
 * Renamed with the project, which orphans anything saved under the old
 * prefix. Deliberate and done before any deployment: the only settings lost
 * are on the machine that wrote them, where re-selecting a posture and
 * re-recording three vowels is a minute's work. After release the same change
 * would silently reset every user instead, so this was the last cheap moment
 * to make it.
 */
const PREFIX = "tabtuber:";

export function readSetting<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    // Validated against the allowed set rather than trusted: stored values
    // outlive the code that wrote them, and a renamed backend would otherwise
    // resurface as an unresolvable name.
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * True the first time it is called with a given id, false ever after.
 *
 * For moving people who already have a value stored onto a changed default.
 * A read of a stored setting cannot tell "chose this" from "was given this
 * by the old default", so changing a default reaches nobody who has run the
 * app before -- which is most people -- without something like this.
 *
 * A one-time reset rather than a forced value, deliberately. Pinning the
 * setting would make the control that changes it a lie; this moves everyone
 * once and then leaves their next choice alone.
 *
 * False when storage is unreadable, which is the safe direction: the
 * caller's fallback already applies there, so there is nothing to migrate
 * and the write would only throw.
 */
export function once(id: string): boolean {
  try {
    const key = `${PREFIX}once:${id}`;
    if (localStorage.getItem(key) !== null) return false;
    localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Persistence is a convenience; losing it is not worth surfacing.
  }
}

/**
 * Stores a small JSON value, for settings that are not a single choice.
 *
 * Validation is the caller's, since this cannot know the shape. A value that
 * fails to parse is treated as absent rather than thrown, because a corrupted
 * preference should cost the preference and not the session.
 */
export function readJson<T>(key: string, validate: (raw: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : validate(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience; losing it is not worth surfacing.
  }
}

export function clearSetting(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // As above.
  }
}

/**
 * Removes every setting this app owns, leaving other sites' keys alone.
 *
 * Takes effect on the next load, since values already read are held in
 * memory. That is stated in the UI rather than worked around, because
 * reloading is what the caller wants anyway: the reason to clear is to see a
 * genuine first run (SPEC.md section 9).
 */
export function clearAllSettings(): string[] {
  const removed: string[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) {
        localStorage.removeItem(key);
        removed.push(key.slice(PREFIX.length));
      }
    }
  } catch {
    // Blocked storage has nothing to clear.
  }
  return removed;
}
