import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function localMigrationVersions(root = repositoryRoot) {
  const migrationsDirectory = resolve(root, "supabase", "migrations");
  const versions = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 4))
    .sort();
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  if (duplicates.length) throw new Error(`Duplicate migration versions: ${[...new Set(duplicates)].join(", ")}`);
  return versions;
}

export function localFunctionNames(root = repositoryRoot) {
  return readdirSync(resolve(root, "supabase", "functions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

export function parseMigrationLedger(stdout) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed.migrations)) throw new Error("Supabase migration output has no migrations array.");
  return parsed.migrations.map((row) => ({
    local: row.local ? String(row.local).padStart(4, "0") : null,
    remote: row.remote ? String(row.remote).padStart(4, "0") : null,
  }));
}

export function analyzeDeploymentState(localVersions, ledger, localFunctions, remoteFunctions) {
  const pendingMigrations = ledger.filter((row) => row.local && !row.remote).map((row) => row.local);
  const remoteOnlyMigrations = ledger.filter((row) => row.remote && !row.local).map((row) => row.remote);
  const ledgerLocal = ledger.filter((row) => row.local).map((row) => row.local);
  const missingFromLedger = localVersions.filter((version) => !ledgerLocal.includes(version));
  const missingFunctions = localFunctions.filter((name) => !remoteFunctions.includes(name));
  return { pendingMigrations, remoteOnlyMigrations, missingFromLedger, missingFunctions };
}

export function resolveLinkedProjectRef(explicitRef, linkedRef) {
  const normalizedLinkedRef = linkedRef.trim();
  const normalizedExplicitRef = explicitRef?.trim() || null;
  if (!/^[a-z0-9]{20}$/.test(normalizedLinkedRef)) {
    throw new Error("A valid linked Supabase project is required.");
  }
  if (normalizedExplicitRef && !/^[a-z0-9]{20}$/.test(normalizedExplicitRef)) {
    throw new Error("A valid --project-ref is required.");
  }
  if (normalizedExplicitRef && normalizedExplicitRef !== normalizedLinkedRef) {
    throw new Error("The --project-ref does not match the linked Supabase project.");
  }
  return normalizedLinkedRef;
}

function run(command, args) {
  if (![command, ...args].every((value) => /^[a-zA-Z0-9._:/-]+$/.test(value))) {
    throw new Error("Deployment preflight refused an unsafe command argument.");
  }
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

export function runPreflight() {
  const localOnly = process.argv.includes("--local-only");
  const localVersions = localMigrationVersions();
  const localFunctions = localFunctionNames();
  console.log(`Local contract: ${localVersions.length} migrations through ${localVersions.at(-1)}; ${localFunctions.length} Edge Functions.`);
  if (localOnly) return;

  const linkedProjectRef = readFileSync(
    resolve(repositoryRoot, "supabase", ".temp", "project-ref"),
    "utf8",
  );
  const projectRef = resolveLinkedProjectRef(argumentValue("--project-ref"), linkedProjectRef);
  const ledger = parseMigrationLedger(run("npx", ["supabase", "migration", "list", "--linked"]));
  const remoteFunctionRows = JSON.parse(run("npx", [
    "supabase", "functions", "list", "--project-ref", projectRef, "--output", "json",
  ]));
  const remoteFunctions = remoteFunctionRows.map((row) => row.slug ?? row.name).filter(Boolean).sort();
  const state = analyzeDeploymentState(localVersions, ledger, localFunctions, remoteFunctions);

  console.log(`Linked project: ${projectRef}`);
  console.log(`Pending migrations: ${state.pendingMigrations.join(", ") || "none"}`);
  console.log(`Remote-only migrations: ${state.remoteOnlyMigrations.join(", ") || "none"}`);
  console.log(`Missing Edge Functions: ${state.missingFunctions.join(", ") || "none"}`);
  if (state.pendingMigrations.length || state.remoteOnlyMigrations.length ||
      state.missingFromLedger.length || state.missingFunctions.length) {
    throw new Error("DEPLOYMENT_DRIFT_BLOCKED: synchronize the backend and rerun before deploying the web application.");
  }
  console.log("DEPLOYMENT_PREFLIGHT: GO");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPreflight();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
