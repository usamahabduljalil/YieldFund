import { expect, it, vi } from "vitest";
import { receiptChecks } from "./receipt-tracking";

it("prevents timer ticks and manual recovery from duplicating a pending check", async () => {
  const check = receiptChecks();
  let finish!: () => void;
  const read = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = check("deposit", read);
  for (let tick = 0; tick < 6; tick++)
    await expect(check("deposit", read)).rejects.toThrow("already in progress");
  const other = vi.fn().mockResolvedValue(undefined);
  await check("withdrawal", other);
  expect(read).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(1);
  finish();
  await first;
  await check("deposit", other);
  expect(other).toHaveBeenCalledTimes(2);
});

it("releases a failed receipt check so an explicit retry can run", async () => {
  const check = receiptChecks();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("RPC unavailable"))
    .mockResolvedValueOnce(undefined);
  await expect(check("deposit", read)).rejects.toThrow("RPC unavailable");
  await expect(check("deposit", read)).resolves.toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
});
