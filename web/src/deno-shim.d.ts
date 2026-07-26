// Satisfies `Deno.env.get()` references in _shared/fatsecret.ts and
// _shared/usda.ts so the web TypeScript build doesn't error on those files.
// Those files are imported in tests for their pure parsing functions only;
// Deno.env is never actually called in the Node/jsdom test environment.
declare const Deno: { env: { get(key: string): string | undefined } };
