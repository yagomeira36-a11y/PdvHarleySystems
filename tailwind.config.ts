// Configuração do Tailwind CSS
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Cores do tema claro (Ponto De Vendas Harley Systems)
      colors: {
        fundo: "#F3F4F6",   // fundo geral (cinza claro)
        card: "#FFFFFF",    // fundo dos cards (branco)
        topo: "#FFFFFF",    // painéis laterais (branco)
      },
    },
  },
  plugins: [],
};

export default config;
