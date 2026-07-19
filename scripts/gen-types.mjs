// Regenerate Supabase TypeScript types from the linked project and write them
// to web/src/lib/database.types.ts.
// Run from the repo root via: cd web && npm run gen:types
// Or directly: node scripts/gen-types.mjs

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(__dirname, "../supabase");
const outputPath = resolve(__dirname, "../web/src/lib/database.types.ts");

console.log("Generating Supabase types from linked project…");
const types = execSync("npx supabase gen types typescript --linked", {
  cwd: supabaseDir,
  encoding: "utf8",
});
writeFileSync(outputPath, types);
console.log("✓ Written to web/src/lib/database.types.ts");
