// At most `limit` of the given functions run at once; the rest wait their turn (the extractions of a run: 3 at a time).
export function createSemaphore(limit) {
  let active = 0;
  const waiting = [];
  // The slot of a finished function goes straight to the next waiting one.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async (task) => {
    if (active < limit) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}
