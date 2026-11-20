const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 35781;
const PROJECT_ROOT = app.getAppPath();
const NODE_EXECUTABLE = app.isPackaged
  ? path.join(process.resourcesPath, "node.exe")
  : path.join(
      PROJECT_ROOT,
      "electron",
      "node_modules",
      "node",
      "bin",
      process.platform === "win32" ? "node.exe" : "node"
    );
const NEXT_EXECUTABLE = path.join(
  PROJECT_ROOT,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);

let serverProcess = null;
let mainWindow = null;
let serverLog = null;

function portaDisponivel() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => reject(
      new Error(`A porta local ${PORT} não está disponível: ${error.message}`)
    ));
    server.listen(PORT, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Não foi possível reservar a porta local do PDV."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(PORT));
    });
  });
}

function servidorRespondendo(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: HOST, port, path: "/login", timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode < 500);
      }
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function aguardarServidor(port) {
  for (let tentativa = 0; tentativa < 80; tentativa += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`O servidor local do PDV encerrou com código ${serverProcess.exitCode}.`);
    }
    if (await servidorRespondendo(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("O servidor local do PDV não iniciou. Consulte o log do desktop.");
}

async function iniciarServidor() {
  if (!fs.existsSync(NODE_EXECUTABLE)) {
    throw new Error(`Node.js não encontrado: ${NODE_EXECUTABLE}`);
  }
  if (!fs.existsSync(NEXT_EXECUTABLE)) {
    throw new Error("A versão desktop do site ainda não foi compilada. Gere o instalador novamente.");
  }

  const port = await portaDisponivel();
  const logPath = path.join(app.getPath("userData"), "next-server.log");
  serverLog = fs.createWriteStream(logPath, { flags: "a" });
  serverProcess = spawn(
    NODE_EXECUTABLE,
    [NEXT_EXECUTABLE, "start", "--hostname", HOST, "--port", String(port)],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        HOSTNAME: HOST,
        NEXT_TELEMETRY_DISABLED: "1",
        PDV_DESKTOP_BUILD: "1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  serverProcess.stdout.pipe(serverLog);
  serverProcess.stderr.pipe(serverLog);
  await aguardarServidor(port);
  return port;
}

async function abrirJanela(port) {
  const appOrigin = `http://${HOST}:${port}`;
  const janelaSession = session.fromPartition("persist:harley-pdv");
  const cookies = await janelaSession.cookies.get({ url: `http://${HOST}:${port}` });
  const temSessao = cookies.some((cookie) => cookie.name === "loja_sessao");
  mainWindow = new BrowserWindow({
    title: "Ponto De Vendas Harley Systems",
    show: false,
    fullscreen: false,
    frame: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    autoHideMenuBar: true,
    icon: path.join(PROJECT_ROOT, "electron", "assets", "harley-systems.ico"),
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:harley-pdv",
    },
  });

  const isAppUrl = (url) => {
    try {
      return new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };
  const openExternalUrl = (url) => {
    let protocol;
    try {
      protocol = new URL(url).protocol;
    } catch {
      return false;
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(protocol)) return false;
    void shell.openExternal(url).catch((error) => {
      console.error(`Não foi possível abrir o link externo "${url}":`, error);
    });
    return true;
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank") return { action: "allow" };
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    if (openExternalUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !mainWindow) return;
    if (input.key === "F11") {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === "Escape" && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`http://${HOST}:${port}${temSessao ? "/pdv" : "/login"}`);
  mainWindow.maximize();
  mainWindow.show();
}

app.whenReady().then(async () => {
  try {
    const port = await iniciarServidor();
    await abrirJanela(port);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Não foi possível iniciar o PDV desktop.";
    dialog.showErrorBox("Ponto De Vendas Harley Systems", mensagem);
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
  if (serverLog) serverLog.end();
});

app.on("window-all-closed", () => app.quit());
