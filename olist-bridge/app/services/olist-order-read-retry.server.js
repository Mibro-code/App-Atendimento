export const DEFAULT_OLIST_ORDER_READ_RETRY_DELAYS_MS = Object.freeze([
  400,
  800,
  1600,
  3200,
  5000,
]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryOlistOrderRead(
  readOrder,
  {
    delays = DEFAULT_OLIST_ORDER_READ_RETRY_DELAYS_MS,
    waitFor = wait,
  } = {},
) {
  if (typeof readOrder !== "function") {
    throw new TypeError("readOrder precisa ser uma função.");
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readOrder();
    } catch (error) {
      if (error?.status !== 404 || attempt >= delays.length) {
        throw error;
      }

      await waitFor(delays[attempt]);
    }
  }
}