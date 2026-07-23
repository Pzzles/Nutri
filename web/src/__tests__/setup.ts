import "@testing-library/jest-dom";

// crypto.randomUUID is not available in jsdom — provide a stable stub.
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.randomUUID) {
  let counter = 0;
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => `00000000-0000-0000-0000-${String(++counter).padStart(12, "0")}`,
    },
    writable: true,
    configurable: true,
  });
}
