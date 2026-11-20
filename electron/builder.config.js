module.exports = {
  appId: "com.harleysystems.pontodevendas",
  productName: "Ponto De Vendas Harley Systems",
  asar: false,
  electronVersion: require("./node_modules/electron/package.json").version,
  electronDist: require("node:path").join(__dirname, "node_modules", "electron", "dist"),
  directories: {
    output: "dist",
  },
  files: [
    "electron/main.js",
    "electron/assets/harley-systems.ico",
    "next.config.js",
    "package.json",
    "public/**/*",
    ".next-desktop/**/*",
    "!**/.env*",
    "!**/.vercel/**",
  ],
  extraResources: [
    {
      from: "electron/node_modules/node/bin/node.exe",
      to: "node.exe",
    },
  ],
  win: {
    icon: "electron/assets/harley-systems.ico",
    target: "nsis",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Ponto De Vendas Harley Systems",
  },
};
