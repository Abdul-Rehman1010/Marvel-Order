import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function javaVersion(javaHome) {
  const executable = path.join(javaHome, "bin", isWindows ? "java.exe" : "java");
  if (!existsSync(executable)) return null;
  const result = spawnSync(executable, ["-version"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version\s+"(\d+)/);
  return match ? Number(match[1]) : null;
}

const localJdkRoot = path.join(projectRoot, ".local-tools", "jdk-21");
const localJdks = existsSync(localJdkRoot)
  ? readdirSync(localJdkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(localJdkRoot, entry.name))
  : [];

const candidates = [
  ...localJdks,
  process.env.JAVA_HOME,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Android", "Android Studio", "jbr"),
].filter(Boolean);

const javaHome = [...new Set(candidates)].find((candidate) => {
  const version = javaVersion(candidate);
  return version !== null && version >= 17 && version <= 24;
});

if (!javaHome) {
  throw new Error("Android builds require JDK 17-24. Install JDK 21 or place a portable JDK under .local-tools/jdk-21.");
}

const androidHome =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"));

if (!androidHome || !existsSync(androidHome)) {
  throw new Error("Android SDK not found. Install it through Android Studio before building.");
}

const environment = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome };
const javaExecutable = path.join(javaHome, "bin", isWindows ? "java.exe" : "java");
const npmCli = process.env.npm_execpath;

if (!npmCli || !existsSync(npmCli)) {
  throw new Error("Run this builder through npm: npm run mobile:apk");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [npmCli, "run", "mobile:sync"], projectRoot);
run(
  javaExecutable,
  [
    "-Xmx64m",
    "-Xms64m",
    "-Dorg.gradle.appname=gradlew",
    "-classpath",
    "",
    "-jar",
    path.join(projectRoot, "android", "gradle", "wrapper", "gradle-wrapper.jar"),
    "assembleDebug",
  ],
  path.join(projectRoot, "android"),
);

console.log(`\nAPK ready: ${path.join(projectRoot, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")}`);
