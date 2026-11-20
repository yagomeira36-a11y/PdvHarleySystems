const { spawnSync } = require("node:child_process");
const path = require("node:path");

const electronExecutable = require("./node_modules/electron");
const mainFile = path.join(__dirname, "main.js");
const result = spawnSync(electronExecutable, [mainFile], {
  cwd: path.resolve(__dirname, ".."),
  stdio: "inherit",
  windowsHide: false,
});

if (result.error) {
  console.error("Não foi possível iniciar o aplicativo Electron:", result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
