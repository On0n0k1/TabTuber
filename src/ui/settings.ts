/*
 * Persisted user settings (SPEC.md section 9).
 *
 * Deliberately tiny. Every accessor is wrapped, because localStorage throws
 * rather than returning null in a private window or with site data blocked,
 * and a thrown setting must not take the whole app down with it. A missing or
 * unreadable value always falls back to the caller's default.
 */

const PREFIX = "virtual-avatar:";

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

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Persistence is a convenience; losing it is not worth surfacing.
  }
}
