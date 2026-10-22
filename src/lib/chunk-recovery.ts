const STORAGE_KEY = "radar:chunk-recovery";
const RETRY_INTERVAL_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .+ failed/i.test(message);
}

// Keep the marker across reloads so a missing deployment cannot cause a reload loop.
export function recoverChunkLoad(
  error: unknown,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  now = Date.now(),
): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const previous = Number(storage.getItem(STORAGE_KEY));
    if (previous > 0 && now - previous < RETRY_INTERVAL_MS) return false;
    storage.setItem(STORAGE_KEY, String(now));
  } catch {
    // Without a persistent guard, leave recovery to the explicit retry button.
    return false;
  }
  reload();
  return true;
}