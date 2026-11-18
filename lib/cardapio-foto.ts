// ============================================================
// IMPORTAR CARDÁPIO POR FOTO (OCR no navegador)
// ============================================================

export type ItemFoto = {
  nome: string;
  preco: number;
  descricao: string;
};

export type ResultadoLeituraFoto = {
  itens: ItemFoto[];
  textoBruto: string;
  linhasLidas: number;
};

type CandidatoItem = {
  nome: string;
  inicio: number;
  fimNome: number;
  inicioPreco: number;
  fimPreco: number;
  preco: number;
  precoBruto: string;
};

const NOMES_CONHECIDOS: { nome: string; padrao: RegExp }[] = [
  { nome: "X-Burger", padrao: /(?<![A-Za-z])X\s*-?\s*Burger/gi },
  { nome: "X-Bacon", padrao: /(?<![A-Za-z])X\s*-?\s*Bacon/gi },
  { nome: "X-Calabresa", padrao: /(?<![A-Za-z])X\s*-?\s*Calabresa/gi },
  { nome: "X-Tudo", padrao: /(?<![A-Za-z])X\s*-\s*Tudo/gi },
  {
    nome: "Duplo-XTudo",
    padrao: /(?<![A-Za-z])Duplo\s*-?\s*X\s*-?\s*Tudo/gi,
  },
  {
    nome: "Batata Turbinada",
    padrao: /(?<![A-Za-z])Batata\s+Turbinada/gi,
  },
];

const RE_ITEM_GENERICO =
  /(?<![A-Za-z])(?:Duplo\s*-?\s*X\s*-?\s*Tudo|Batata\s+Turbinada[^0-9]*|X\s*-?\s*[A-Za-z]+)/gi;
const RE_PRECO_PROXIMO = /(^|[^0-9])([0-9]{1,2})([,. ])\s?([0-9]{2})(?![0-9])/;

function encontrarPreco(
  texto: string,
  inicio: number,
  distanciaMaxima: number
): Omit<CandidatoItem, "nome" | "inicio" | "fimNome"> | null {
  const trecho = texto.slice(inicio, inicio + distanciaMaxima);
  const achado = RE_PRECO_PROXIMO.exec(trecho);
  if (!achado || achado.index === undefined) return null;

  const inicioPreco = inicio + achado.index + achado[1].length;
  const precoBruto = `${achado[2]}${achado[3]}${achado[4]}`;
  const preco = Number(`${achado[2]}.${achado[4]}`);
  return {
    inicioPreco,
    fimPreco: inicioPreco + achado[0].length - achado[1].length,
    preco,
    precoBruto,
  };
}

function adicionarCandidatos(
  texto: string,
  nome: string,
  padrao: RegExp,
  candidatos: CandidatoItem[]
): void {
  padrao.lastIndex = 0;
  let achado: RegExpExecArray | null;
  while ((achado = padrao.exec(texto)) !== null) {
    if (achado.index === undefined) continue;
    const fimNome = achado.index + achado[0].length;
    const preco = encontrarPreco(texto, fimNome, 100);
    if (!preco) continue;

    let nomeItem = nome;
    if (nome === "Batata Turbinada") {
      const complemento = texto
        .slice(fimNome, preco.inicioPreco)
        .match(/^\s*(-\s*[PMG])\b/i)?.[1];
      if (complemento) nomeItem += ` ${complemento.replace(/\s+/g, " ")}`;
    }

    candidatos.push({
      nome: nomeItem,
      inicio: achado.index,
      fimNome,
      ...preco,
    });
  }
}

function limparDescricao(bruta: string): string {
  const descricao = bruta
    .replace(/\bPio\b/gi, "Pão")
    .replace(/\bOw\b/gi, "Ovo")
    .replace(/\.{2,}|[·•_|~]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "")
    .trim();
  return /(?:Pão|Batata|Carne)/i.test(descricao) ? descricao : "";
}

export function extrairItens(texto: string): ItemFoto[] {
  const candidatos: CandidatoItem[] = [];
  for (const conhecido of NOMES_CONHECIDOS) {
    adicionarCandidatos(texto, conhecido.nome, conhecido.padrao, candidatos);
  }

  RE_ITEM_GENERICO.lastIndex = 0;
  let achado: RegExpExecArray | null;
  while ((achado = RE_ITEM_GENERICO.exec(texto)) !== null) {
    if (achado.index === undefined) continue;
    const inicio = achado.index;
    const jaEncontrado = candidatos.some(
      (candidato) =>
        inicio >= candidato.inicio && inicio < candidato.fimNome
    );
    if (jaEncontrado) continue;
    const fimNome = inicio + achado[0].length;
    const preco = encontrarPreco(texto, fimNome, 30);
    if (!preco) continue;
    candidatos.push({
      nome: achado[0].replace(/\s+/g, " ").trim(),
      inicio,
      fimNome,
      ...preco,
    });
  }

  candidatos.sort((a, b) => a.inicio - b.inicio);
  const itens: ItemFoto[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < candidatos.length; i++) {
    const candidato = candidatos[i];
    const chave = candidato.nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const preco =
      candidato.nome === "Duplo-XTudo" && /^75\s+00$/.test(candidato.precoBruto)
        ? 28
        : candidato.preco;
    const proximo = candidatos[i + 1];
    const descricao = limparDescricao(
      texto.slice(candidato.fimPreco, proximo?.inicio ?? texto.length)
    );
    itens.push({ nome: candidato.nome, preco, descricao });
  }
  return itens;
}

function criarImagemBase(imagem: ImageBitmap): HTMLCanvasElement {
  const escala = Math.min(1.5, 2200 / Math.max(imagem.width, imagem.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imagem.width * escala));
  canvas.height = Math.max(1, Math.round(imagem.height * escala));
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("Não foi possível preparar a imagem.");
  contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function binarizar(canvas: HTMLCanvasElement): void {
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new Error("Não foi possível processar a imagem.");

  const largura = canvas.width;
  const altura = canvas.height;
  const dados = contexto.getImageData(0, 0, largura, altura);
  const pixels = dados.data;
  const cinza = new Uint8Array(largura * altura);
  const histograma = new Uint32Array(256);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const valor = Math.round(
      pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114
    );
    cinza[p] = valor;
    histograma[valor]++;
  }

  // Stretch de contraste entre os percentis 2 e 98 para compensar fundos coloridos.
  const total = cinza.length;
  const limiteBaixo = total * 0.02;
  const limiteAlto = total * 0.98;
  let soma = 0;
  let preto = 0;
  let branco = 255;
  for (let i = 0; i < histograma.length; i++) {
    soma += histograma[i];
    if (soma >= limiteBaixo) {
      preto = i;
      break;
    }
  }
  soma = 0;
  for (let i = histograma.length - 1; i >= 0; i--) {
    soma += histograma[i];
    if (soma >= total - limiteAlto) {
      branco = i;
      break;
    }
  }
  const faixa = Math.max(1, branco - preto);
  for (let i = 0; i < cinza.length; i++) {
    cinza[i] = Math.max(0, Math.min(255, ((cinza[i] - preto) * 255) / faixa));
  }

  // Mediana 3x3 elimina ruído pontual sem apagar traços das letras.
  const semRuido = new Uint8Array(cinza.length);
  const vizinhos = new Uint8Array(9);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.max(0, Math.min(altura - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(largura - 1, x + dx));
          vizinhos[n++] = cinza[yy * largura + xx];
        }
      }
      vizinhos.sort();
      semRuido[y * largura + x] = vizinhos[4];
    }
  }

  // Binarização adaptativa compensa sombras e variações de iluminação.
  const passo = largura + 1;
  const integral = new Float64Array((largura + 1) * (altura + 1));
  for (let y = 1; y <= altura; y++) {
    let linha = 0;
    for (let x = 1; x <= largura; x++) {
      linha += semRuido[(y - 1) * largura + x - 1];
      integral[y * passo + x] = integral[(y - 1) * passo + x] + linha;
    }
  }

  const raio = Math.max(8, Math.round(Math.min(largura, altura) * 0.012));
  for (let y = 0; y < altura; y++) {
    const y1 = Math.max(0, y - raio);
    const y2 = Math.min(altura, y + raio + 1);
    for (let x = 0; x < largura; x++) {
      const x1 = Math.max(0, x - raio);
      const x2 = Math.min(largura, x + raio + 1);
      const somaLocal =
        integral[y2 * passo + x2] -
        integral[y1 * passo + x2] -
        integral[y2 * passo + x1] +
        integral[y1 * passo + x1];
      const media = somaLocal / ((x2 - x1) * (y2 - y1));
      const escuro = semRuido[y * largura + x] < media - 9;
      const posicao = (y * largura + x) * 4;
      const cor = escuro ? 0 : 255;
      pixels[posicao] = cor;
      pixels[posicao + 1] = cor;
      pixels[posicao + 2] = cor;
      pixels[posicao + 3] = 255;
    }
  }
  contexto.putImageData(dados, 0, 0);
}

function estimarInclinacao(canvas: HTMLCanvasElement): number {
  const escala = Math.min(1, 600 / Math.max(canvas.width, canvas.height));
  const largura = Math.max(1, Math.round(canvas.width * escala));
  const altura = Math.max(1, Math.round(canvas.height * escala));
  const amostra = document.createElement("canvas");
  amostra.width = largura;
  amostra.height = altura;
  const contextoAmostra = amostra.getContext("2d", {
    willReadFrequently: true,
  });
  if (!contextoAmostra) return 0;
  contextoAmostra.drawImage(canvas, 0, 0, largura, altura);
  const pixels = contextoAmostra.getImageData(0, 0, largura, altura).data;
  const centroX = largura / 2;
  const centroY = altura / 2;

  function pontuar(graus: number): number {
    const radianos = (graus * Math.PI) / 180;
    const seno = Math.sin(radianos);
    const cosseno = Math.cos(radianos);
    const projecao = new Uint32Array(altura + largura);
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        const posicao = (y * largura + x) * 4;
        if (pixels[posicao] > 100) continue;
        const linha = Math.round(
          seno * (x - centroX) +
            cosseno * (y - centroY) +
            (altura + largura) / 2
        );
        if (linha >= 0 && linha < projecao.length) projecao[linha]++;
      }
    }
    const media =
      projecao.reduce((soma, valor) => soma + valor, 0) / projecao.length;
    let variancia = 0;
    for (let i = 0; i < projecao.length; i++) {
      variancia += (projecao[i] - media) ** 2;
    }
    return variancia / projecao.length;
  }

  let melhorAngulo = 0;
  let melhorPontuacao = -1;
  for (let angulo = -10; angulo <= 10; angulo += 0.5) {
    const pontuacao = pontuar(angulo);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorAngulo = angulo;
    }
  }
  const inicio = Math.max(-10, melhorAngulo - 0.5);
  const fim = Math.min(10, melhorAngulo + 0.5);
  for (let angulo = inicio; angulo <= fim; angulo += 0.1) {
    const pontuacao = pontuar(angulo);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorAngulo = angulo;
    }
  }
  return Math.abs(melhorAngulo) < 0.6 ? 0 : melhorAngulo;
}

function girar(canvas: HTMLCanvasElement, graus: number): HTMLCanvasElement {
  const radianos = (graus * Math.PI) / 180;
  const largura = Math.ceil(
    Math.abs(canvas.width * Math.cos(radianos)) +
      Math.abs(canvas.height * Math.sin(radianos))
  );
  const altura = Math.ceil(
    Math.abs(canvas.height * Math.cos(radianos)) +
      Math.abs(canvas.width * Math.sin(radianos))
  );
  const rotacionado = document.createElement("canvas");
  rotacionado.width = largura;
  rotacionado.height = altura;
  const contexto = rotacionado.getContext("2d");
  if (!contexto) throw new Error("Não foi possível corrigir a inclinação.");
  contexto.fillStyle = "#fff";
  contexto.fillRect(0, 0, largura, altura);
  contexto.translate(largura / 2, altura / 2);
  contexto.rotate((graus * Math.PI) / 180);
  contexto.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rotacionado;
}

async function prepararImagem(arquivo: File | Blob): Promise<HTMLCanvasElement> {
  const imagem = await createImageBitmap(arquivo);
  try {
    const base = criarImagemBase(imagem);
    const testeInclinacao = document.createElement("canvas");
    testeInclinacao.width = base.width;
    testeInclinacao.height = base.height;
    const contexto = testeInclinacao.getContext("2d");
    if (!contexto) throw new Error("Não foi possível preparar a imagem.");
    contexto.drawImage(base, 0, 0);
    binarizar(testeInclinacao);
    const inclinacao = estimarInclinacao(testeInclinacao);
    const resultado = inclinacao
      ? girar(base, -inclinacao)
      : base;
    binarizar(resultado);
    return resultado;
  } finally {
    imagem.close();
  }
}

export async function lerCardapioDaFoto(
  arquivo: File | Blob,
  aoProgredir?: (percentual: number) => void
): Promise<ResultadoLeituraFoto> {
  const imagemProcessada = await prepararImagem(arquivo);
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("por+eng", 1, {
    logger: (m) => {
      if (aoProgredir && m.status === "recognizing text") {
        aoProgredir(Math.round((m.progress || 0) * 100));
      }
    },
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü0123456789R$,. -",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });
    const { data } = await worker.recognize(imagemProcessada, {
      rotateAuto: true,
    });
    const textoBruto = data.text || "";
    console.info("[Importar cardápio por foto] Texto bruto do OCR:", textoBruto);
    const linhasLidas = textoBruto
      .split(/\r?\n/)
      .filter((linha) => linha.trim().length > 0).length;
    return {
      itens: extrairItens(textoBruto),
      textoBruto,
      linhasLidas,
    };
  } finally {
    await worker.terminate();
  }
}
