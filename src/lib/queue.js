// All read/modify/write operations share this queue. Network discovery runs outside it.
let tail = Promise.resolve();
export function mutate(operation) {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}
