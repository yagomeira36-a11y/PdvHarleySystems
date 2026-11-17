// Layout raiz da aplicação
import type { Metadata } from "next";
import "./globals.css";

// Título exibido na aba do navegador
export const metadata: Metadata = {
  title: "PDV Hamburgueria",
  description: "PDV para hamburgueria com delivery e motoboys",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
