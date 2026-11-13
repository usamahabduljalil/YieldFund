/** One pending receipt check per saved submission, including manual recovery. */
export function receiptChecks() {
  const pending = new Set<string>();
  return async (id: string, read: () => Promise<void>): Promise<void> => {
    if (pending.has(id)) throw new Error("Receipt check already in progress.");
    pending.add(id);
    try {
      await read();
    } finally {
      pending.delete(id);
    }
  };
}
