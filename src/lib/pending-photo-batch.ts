/** One atomic batch at a time; cancelled work must never publish stale photos. */
export function createPendingPhotoBatch(options: {
  compress: (file: File) => Promise<Blob>;
  append: (blobs: Blob[]) => void;
  busy: (value: boolean) => void;
  error: (error: unknown) => void;
}) {
  let running = false;
  let generation = 0;
  return {
    get busy() { return running; },
    async add(files: File[]) {
      if (!files.length || running) return;
      const run = ++generation;
      running = true;
      options.busy(true);
      try {
        const blobs: Blob[] = [];
        for (const file of files) {
          blobs.push(await options.compress(file));
          if (generation !== run) return;
        }
        options.append(blobs);
      } catch (error) {
        if (generation === run) options.error(error);
      } finally {
        if (generation === run) {
          running = false;
          options.busy(false);
        }
      }
    },
    cancel() {
      generation++;
      if (running) { running = false; options.busy(false); }
    },
  };
}
