const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const androidDir = path.resolve(__dirname, "..", "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";

if (!fs.existsSync(path.join(androidDir, wrapper))) {
  console.error("Projeto Android ausente. Execute `npm run android:sync` primeiro.");
  process.exitCode = 1;
} else {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : `./${wrapper}`;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `${wrapper} assembleDebug`]
      : ["assembleDebug"];
  const result = spawnSync(command, args, {
    cwd: androidDir,
    stdio: "inherit",
  });

  if (result.error) {
    console.error("Não foi possível executar o Gradle:", result.error);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    console.log(
      `APK gerado em: ${path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk")}`
    );
  }
}
