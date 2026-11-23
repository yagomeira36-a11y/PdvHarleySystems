import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.harleysystems.pontodevendas",
  appName: "Ponto De Vendas Harley Systems",
  webDir: "capacitor-web",
  server: {
    url: "https://pdvharleysystems-aibjds6ud-pdv-dg.vercel.app",
    cleartext: false,
    allowNavigation: [
      "pdvharleysystems-aibjds6ud-pdv-dg.vercel.app",
      "*.vercel.app"
    ],
  },
};

export default config;