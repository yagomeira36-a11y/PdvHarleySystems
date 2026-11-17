// ============================================================
// CONFIGURAÇÃO DE LAYOUT DA LOJA (cor, letras, tamanho e logo)
// Fica salva no navegador (localStorage) por loja, então não
// precisa de SQL no Supabase para funcionar.
// ============================================================

export type TamanhoLetra = "pequeno" | "medio" | "grande";

export type LayoutConfig = {
  cor: string; // cor principal do layout (sidebar)
  corLetras: string; // cor das letras do menu
  tamanho: TamanhoLetra; // tamanho das letras do app
  logo: string | null; // imagem da loja (dataURL) ou null
  fundo: string | null; // imagem de fundo da área principal (dataURL) ou null
  cardapio: string | null; // imagem do cardápio (dataURL) ou null
};

export const LAYOUT_PADRAO: LayoutConfig = {
  cor: "#2563EB",
  corLetras: "#ffffff",
  tamanho: "medio",
  logo: null,
  fundo: null,
  cardapio: null,
};

// Tamanho base da fonte no <html> para cada opção
export const TAMANHO_FONTE: Record<TamanhoLetra, number> = {
  pequeno: 14,
  medio: 16,
  grande: 18,
};

export function chaveLayout(lojaId: string): string {
  return `pdv_layout_${lojaId}`;
}

export function lerLayout(lojaId: string): LayoutConfig {
  try {
    const bruto = localStorage.getItem(chaveLayout(lojaId));
    if (!bruto) return { ...LAYOUT_PADRAO };
    const salvo = JSON.parse(bruto) as Partial<LayoutConfig>;
    return {
      cor: typeof salvo.cor === "string" && salvo.cor ? salvo.cor : LAYOUT_PADRAO.cor,
      corLetras:
        typeof salvo.corLetras === "string" && salvo.corLetras
          ? salvo.corLetras
          : LAYOUT_PADRAO.corLetras,
      tamanho:
        salvo.tamanho === "pequeno" ||
        salvo.tamanho === "medio" ||
        salvo.tamanho === "grande"
          ? salvo.tamanho
          : LAYOUT_PADRAO.tamanho,
      logo: typeof salvo.logo === "string" ? salvo.logo : null,
      fundo: typeof salvo.fundo === "string" ? salvo.fundo : null,
      cardapio: typeof salvo.cardapio === "string" ? salvo.cardapio : null,
    };
  } catch {
    return { ...LAYOUT_PADRAO };
  }
}

export function salvarLayout(lojaId: string, config: LayoutConfig) {
  localStorage.setItem(chaveLayout(lojaId), JSON.stringify(config));
  // Avisa o LayoutMenu (e quem mais estiver aberto) para aplicar na hora
  window.dispatchEvent(new CustomEvent("pdv-layout-atualizado"));
}

// Escurece uma cor hex (#RRGGBB) em uma porcentagem (0 a 1)
export function escurecer(hex: string, fator: number): string {
  const limpo = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return hex;
  const n = parseInt(limpo, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - fator)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - fator)));
  const b = Math.max(0, Math.round((n & 255) * (1 - fator)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
