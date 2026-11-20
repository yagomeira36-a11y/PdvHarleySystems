import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl =
  process.env.CAPACITOR_SERVER_URL ?? "https://pdv-hamburgueria.vercel.app";

const config: CapacitorConfig = {
  appId: "com.harleysystems.pontodevendas",
  appName: "Ponto De Vendas Harley Systems",
  webDir: "capacitor-web",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    androidScheme: "https",
  },
};

export default config;
