import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(webRoot, "..");

export function isLoopbackUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

export function parseLocalSupabaseStatus(stdout) {
  const status = JSON.parse(stdout);
  if (!isLoopbackUrl(status.API_URL) || typeof status.ANON_KEY !== "string" || !status.ANON_KEY) {
    throw new Error("Supabase CLI did not return a valid local API URL and anon key.");
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY };
}

function localSupabaseEnvironment() {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx supabase status --output json"]
    : ["supabase", "status", "--output", "json"];
  const result = spawnSync(
    command,
    commandArgs,
    { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message;
    throw new Error(
      `Local Supabase is not available. Run \`npx supabase start\` first.${detail ? ` ${detail}` : ""}`,
    );
  }
  return parseLocalSupabaseStatus(result.stdout);
}

export function startLocalDev(args = process.argv.slice(2)) {
  const local = localSupabaseEnvironment();
  const viteEntry = resolve(webRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteEntry, ...args], {
    cwd: webRoot,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: local.url,
      VITE_SUPABASE_ANON_KEY: local.anonKey,
    },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    startLocalDev();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
