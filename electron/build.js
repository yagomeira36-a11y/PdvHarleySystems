const { spawnSync } = require("node:child_process");
const { build, Platform } = require("electron-builder");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const env = { ...process.env, PDV_DESKTOP_BUILD: "1" };

function executar(comando, argumentos) {
  const resultado = spawnSync(comando, argumentos, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) {
    throw new Error(`${path.basename(comando)} encerrou com código ${resultado.status}.`);
  }
}

async function main() {
  executar(process.execPath, [
    require.resolve("next/dist/bin/next"),
    "build",
  ]);
  await build({
    config: require("./builder.config"),
    targets: Platform.WINDOWS.createTarget("nsis"),
  });
}

main().catch((error) => {
  console.error("Falha ao gerar o instalador desktop:", error);
  process.exitCode = 1;
});
