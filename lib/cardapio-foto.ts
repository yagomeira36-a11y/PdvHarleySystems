// ============================================================
// IMPORTAR CARDÁPIO POR FOTO (OCR no navegador)
// Lê a foto do cardápio com o Tesseract.js — roda no próprio
// computador, sem chave de API e sem serviço pago — e extrai os
// itens do cardápio no formato "nome + preço".
// O resultado é sempre revisado pelo usuário antes de salvar.
// ============================================================

export type ItemFoto = {
  nome: string;
  preco: number;
};

// Preço no fim da linha: "29,90", "R$ 29,90", "1.299,90"
const RE_PRECO = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)\s*[,.]\s*(\d{2})\s*$/;

// Limpa o nome: tira pontinhos/traços do fim e número de índice do começo
function limparNome(bruto: string): string {
  return bruto
    .replace(/[\s.·•_\-–—:*]+$/g, "")
    .replace(/^\s*\d{1,3}\s*[.)\-–—]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Transforma o texto lido pela OCR em itens do cardápio
export function extrairItens(texto: string): ItemFoto[] {
  const itens: ItemFoto[] = [];
  const vistos = new Set<string>();

  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (linha.length < 3) continue;

    const achado = linha.match(RE_PRECO);
    if (!achado || achado.index === undefined) continue;

    const nome = limparNome(linha.slice(0, achado.index));
    const preco = Number(`${achado[1].replace(/\./g, "")}.${achado[2]}`);
    if (!nome || nome.length < 2 || !Number.isFinite(preco) || preco <= 0) continue;

    const chave = nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ nome, preco });
  }

  return itens;
}

// Lê a foto do cardápio e devolve os itens encontrados (nome + preço)
export async function lerCardapioDaFoto(
  arquivo: File | Blob,
  aoProgredir?: (percentual: number) => void
): Promise<ItemFoto[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por", 1, {
    logger: (m) => {
      if (aoProgredir && m.status === "recognizing text") {
        aoProgredir(Math.round((m.progress || 0) * 100));
      }
    },
  });
  try {
    const { data } = await worker.recognize(arquivo);
    return extrairItens(data.text || "");
  } finally {
    await worker.terminate();
  }
}
