// Configuração do Next.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.PDV_DESKTOP_BUILD === "1"
    ? {
        distDir: ".next-desktop",
        typescript: { tsconfigPath: "tsconfig.desktop.json" },
      }
    : {}),
};

module.exports = nextConfig;
