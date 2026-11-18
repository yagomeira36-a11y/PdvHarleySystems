// ============================================================
// CONFIGURAÇÃO DE LAYOUT DA LOJA (cor, letras, tamanho e logo)
// Fica salva no navegador (localStorage) por loja, então não
// precisa de SQL no Supabase para funcionar.
// ============================================================

export type TamanhoLetra = "pequeno" | "medio" | "grande";

// ============================================================
// MENUS DO LATERAL (quais aparecem e em que ordem)
// ============================================================
export type MenuId =
  | "mesa"
  | "balcao"
  | "delivery"
  | "kds"
  | "finalizados"
  | "gerenciamento"
  | "configuracoes";

export type MenuGrupo = "pedidos" | "gerenciamento";

export type MenuDef = {
  id: MenuId;
  grupo: MenuGrupo;
  rotulo: string;
  bloqueiaCaixa: boolean; // fica bloqueado quando o caixa está fechado
};

// Catálogo de todos os menus do sistema (ordem padrão)
export const MENUS_CATALOGO: MenuDef[] = [
  { id: "mesa", grupo: "pedidos", rotulo: "Mesa", bloqueiaCaixa: true },
  { id: "balcao", grupo: "pedidos", rotulo: "Balcão", bloqueiaCaixa: true },
  { id: "delivery", grupo: "pedidos", rotulo: "Delivery", bloqueiaCaixa: true },
  { id: "kds", grupo: "pedidos", rotulo: "Cozinha", bloqueiaCaixa: true },
  {
    id: "finalizados",
    grupo: "pedidos",
    rotulo: "Pedido Finalizado",
    bloqueiaCaixa: false,
  },
  {
    id: "gerenciamento",
    grupo: "gerenciamento",
    rotulo: "Gerenciamento de loja",
    bloqueiaCaixa: false,
  },
  {
    id: "configuracoes",
    grupo: "gerenciamento",
    rotulo: "Configurações",
    bloqueiaCaixa: false,
  },
];

// Menu escolhido pelo dono: aparece? (a ordem é a posição na lista)
export type MenuConfig = { id: MenuId; visivel: boolean };

export const MENUS_PADRAO: MenuConfig[] = MENUS_CATALOGO.map((d) => ({
  id: d.id,
  visivel: true,
}));

export const ROTULO_GRUPO: Record<MenuGrupo, string> = {
  pedidos: "Painel de Pedidos",
  gerenciamento: "Gerenciamento",
};

export function definicaoMenu(id: MenuId): MenuDef {
  return MENUS_CATALOGO.find((d) => d.id === id) || MENUS_CATALOGO[0];
}

// Ordena/valida os menus salvos e completa com os que faltarem (ex: um
// menu novo criado numa versão mais recente). Os menus "Gerenciamento de
// loja" e "Configurações" nunca podem ficar escondidos: é por eles que o
// dono acessa Cadastrar Produto, Estoque, Caixa, Relatórios, Layout,
// Motoboys e Bot Assistente.
export function menusOrdenados(salvo?: MenuConfig[] | null): MenuConfig[] {
  const validos = new Set<string>(MENUS_CATALOGO.map((d) => d.id));
  const fixos = new Set<string>(["gerenciamento", "configuracoes"]);
  const ordem: MenuConfig[] = [];
  const vistos = new Set<string>();
  for (const item of salvo || []) {
    if (!item || !validos.has(item.id) || vistos.has(item.id)) continue;
    vistos.add(item.id);
    ordem.push({ id: item.id, visivel: fixos.has(item.id) ? true : item.visivel !== false });
  }
  for (const def of MENUS_CATALOGO) {
    if (!vistos.has(def.id)) ordem.push({ id: def.id, visivel: true });
  }
  return ordem;
}

export type LayoutConfig = {
  cor: string; // cor principal do layout (sidebar)
  corLetras: string; // cor das letras do menu
  tamanho: TamanhoLetra; // tamanho das letras do app
  logo: string | null; // imagem da loja (dataURL) ou null
  fundo: string | null; // imagem de fundo da área principal (dataURL) ou null
  cardapio: string | null; // imagem do cardápio (dataURL) ou null
  menus: MenuConfig[]; // menus visíveis e sua ordem
};

export const LAYOUT_PADRAO: LayoutConfig = {
  cor: "#2563EB",
  corLetras: "#ffffff",
  tamanho: "medio",
  logo: null,
  fundo: null,
  cardapio: null,
  menus: MENUS_PADRAO,
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
      menus: menusOrdenados(salvo.menus),
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
