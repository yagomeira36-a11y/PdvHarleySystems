// ============================================================
// CATEGORIAS DE PRODUTO DA LOJA (livres, ex: "molhos")
// Fica salva no navegador (localStorage) por loja — o dono pode
// criar quantas categorias quiser sem mexer no banco.
// ============================================================

// Categoria padrão para loja nova (sem produtos/categorias pré-cadastradas)
export const CATEGORIAS_PADRAO = ["TODOS"];

export function chaveCategorias(lojaId: string): string {
  return `pdv_categorias_${lojaId}`;
}

// Lê a lista de categorias da loja (padrão se nunca foi salvo)
export function lerCategorias(lojaId: string): string[] {
  try {
    const bruto = localStorage.getItem(chaveCategorias(lojaId));
    if (!bruto) return [...CATEGORIAS_PADRAO];
    const salvo = JSON.parse(bruto);
    if (!Array.isArray(salvo)) return [...CATEGORIAS_PADRAO];
    // Mantém só textos válidos e sem repetição
    const lista = salvo.filter(
      (c: unknown): c is string => typeof c === "string" && c.trim() !== ""
    );
    const unicas = Array.from(new Set(lista));
    return unicas;
  } catch {
    return [...CATEGORIAS_PADRAO];
  }
}

export function inicializarCategorias(
  lojaId: string,
  categoriasProdutos: string[]
): string[] {
  if (localStorage.getItem(chaveCategorias(lojaId)) !== null) {
    return lerCategorias(lojaId);
  }
  const lista = Array.from(new Set([
    ...CATEGORIAS_PADRAO,
    ...categoriasProdutos
      .filter((categoria) => typeof categoria === "string" && categoria.trim() !== "" && categoria !== "TODOS"),
  ]));
  salvarCategorias(lojaId, lista);
  return lista;
}

export function salvarCategorias(lojaId: string, lista: string[]) {
  localStorage.setItem(chaveCategorias(lojaId), JSON.stringify(lista));
}
