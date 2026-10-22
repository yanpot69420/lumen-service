/** Debounce draft writes, but let navigation and submit flush the latest value. */
export function createBufferedDraft<T>(write: (value: T) => Promise<void>, delay = 400, onSaved?: () => void) {
  let latest: T | undefined;
  let queued: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let paused = false;

  function cancelTimer() { clearTimeout(timer); timer = undefined; }
  function set(value: T) { latest = value; }
  function flush() {
    cancelTimer();
    if (paused || latest === undefined || latest === queued) return queue;
    const value = latest;
    queued = value;
    queue = queue.catch(() => {}).then(async () => {
      await write(value);
      onSaved?.();
    }).catch((error) => {
      if (queued === value) queued = undefined;
      throw error;
    });
    return queue;
  }
  return {
    set,
    flush,
    schedule(value: T, onError: (error: unknown) => void) {
      set(value);
      cancelTimer();
      if (!paused) timer = setTimeout(() => { void flush().catch(onError); }, delay);
    },
    pause() { paused = true; cancelTimer(); },
    resume() { paused = false; },
    cancelTimer,
  };
}
