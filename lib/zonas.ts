// ============================================================
// ZONAS DE ENTREGA (raios no mapa, estilo iFood)
// As zonas e o centro da loja são compartilhados entre o PDV e o
// cardápio online pelo endpoint de configurações da loja.
// ============================================================

export type Zona = {
  id: string;
  nome: string;
  cor: string;
  raioKm: number; // raio do círculo em KM
  taxa: number; // valor da entrega dessa zona em R$
  ativo: boolean;
};

export type ConfigZonas = {
  lat: number; // posição da loja (pin) no mapa
  lng: number;
  zonas: Zona[];
};

// Paleta de cores das zonas (aplicada da menor para a maior)
export const CORES_ZONAS = [
  "#22c55e", // verde
  "#3b82f6", // azul
  "#f59e0b", // laranja
  "#a855f7", // roxo
  "#ef4444", // vermelho
  "#14b8a6", // turquesa
  "#ec4899", // rosa
  "#84cc16", // lima
];

// Centro padrão quando a loja ainda não tem pin (São Paulo)
export const CENTRO_PADRAO = { lat: -23.5505, lng: -46.6333 };

export function chaveZonas(lojaId: string): string {
  return `pdv_zonas_${lojaId}`;
}

export function novoIdZona(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function configZonasVazia(): ConfigZonas {
  return { lat: CENTRO_PADRAO.lat, lng: CENTRO_PADRAO.lng, zonas: [] };
}

// Cor da zona pela posição (ordenada do menor raio para o maior)
export function corZona(index: number): string {
  return CORES_ZONAS[index % CORES_ZONAS.length];
}

// Ordena as zonas do menor para o maior raio
export function zonasOrdenadas(zonas: Zona[]): Zona[] {
  return [...zonas]
    .filter((z) => Number.isFinite(z.raioKm) && z.raioKm > 0)
    .sort((a, b) => a.raioKm - b.raioKm);
}

export function normalizarDeliveryZones(valor: unknown): Zona[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter(
      (zona): zona is Record<string, unknown> =>
        !!zona && typeof zona === "object"
    )
    .map((zona, indice) => ({
      id: typeof zona.id === "string" ? zona.id : novoIdZona(),
      nome:
        typeof zona.nome === "string" && zona.nome.trim()
          ? zona.nome
          : `Zona ${indice + 1}`,
      cor:
        typeof zona.cor === "string" && zona.cor
          ? zona.cor
          : corZona(indice),
      raioKm: Number(zona.raioKm) || 0,
      taxa: Number(zona.taxa ?? zona.valor) || 0,
      ativo: typeof zona.ativo === "boolean" ? zona.ativo : true,
    }));
}

// Lê as zonas salvas da loja (padrão quando nunca foi salvo)
export function lerZonas(lojaId: string): ConfigZonas {
  try {
    const bruto = localStorage.getItem(chaveZonas(lojaId));
    if (!bruto) return configZonasVazia();
    const salvo = JSON.parse(bruto);
    const lat = Number(salvo?.lat);
    const lng = Number(salvo?.lng);
    return {
      lat: Number.isFinite(lat) ? lat : CENTRO_PADRAO.lat,
      lng: Number.isFinite(lng) ? lng : CENTRO_PADRAO.lng,
      zonas: normalizarDeliveryZones(salvo?.zonas),
    };
  } catch {
    return configZonasVazia();
  }
}

export function salvarZonas(lojaId: string, cfg: ConfigZonas) {
  localStorage.setItem(chaveZonas(lojaId), JSON.stringify(cfg));
}

export async function carregarDeliveryZones(
  lojaId: string,
  migrarZonasLocais = true
): Promise<ConfigZonas> {
  const local = lerZonas(lojaId);
  const resposta = await fetch(
    `/api/store-settings?loja=${encodeURIComponent(lojaId)}`,
    { cache: "no-store" }
  );
  if (!resposta.ok) {
    throw new Error("Não foi possível carregar as zonas de entrega.");
  }
  const settings = (await resposta.json()) as Record<string, unknown>;
  const zonasRemotas = Array.isArray(settings.raios)
    ? normalizarDeliveryZones(settings.raios)
    : Array.isArray(settings.taxas_raio)
      ? normalizarDeliveryZones(settings.taxas_raio)
      : null;
  const centro =
    settings.delivery_center && typeof settings.delivery_center === "object"
      ? (settings.delivery_center as Record<string, unknown>)
      : null;
  const lat = Number(centro?.lat);
  const lng = Number(centro?.lng);
  const config: ConfigZonas = {
    lat: Number.isFinite(lat) ? lat : local.lat,
    lng: Number.isFinite(lng) ? lng : local.lng,
    zonas: zonasRemotas ?? (migrarZonasLocais ? local.zonas : []),
  };

  if (
    migrarZonasLocais &&
    zonasRemotas &&
    zonasRemotas.length === 0 &&
    local.zonas.length > 0
  ) {
    await salvarDeliveryZones(lojaId, { ...config, zonas: local.zonas });
    return { ...config, zonas: local.zonas };
  }

  salvarZonas(lojaId, config);
  return config;
}

export async function salvarDeliveryZones(
  lojaId: string,
  config: ConfigZonas
): Promise<void> {
  const zonas = normalizarDeliveryZones(config.zonas);
  const resposta = await fetch("/api/store-settings", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raios: zonas,
      delivery_center: { lat: config.lat, lng: config.lng },
    }),
  });
  const resultado = (await resposta.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!resposta.ok) {
    throw new Error(resultado?.error || "Não foi possível salvar as zonas.");
  }
  const salva = { ...config, zonas };
  salvarZonas(lojaId, salva);
  window.dispatchEvent(
    new CustomEvent("pdv-delivery-zones-atualizado", {
      detail: { lojaId, config: salva },
    })
  );
}

// Distância em KM entre dois pontos (fórmula de Haversine)
export function distanciaKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // raio da Terra em KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Descobre a zona certa para uma distância
// (a menor zona cujo raio cobre a distância)
export function zonaParaDistancia(distKm: number, zonas: Zona[]): Zona | null {
  for (const z of zonasOrdenadas(zonas).filter((zona) => zona.ativo)) {
    if (distKm <= z.raioKm) return z;
  }
  return null; // fora de todas as zonas
}

// Geocodifica um endereço em coordenadas usando o OpenStreetMap
// (Nominatim, gratuito e sem chave de API).
export async function geocodificar(
  endereco: string,
  perto?: { lat: number; lng: number }
): Promise<{ lat: number; lng: number; label: string } | null> {
  const texto = endereco.trim();
  if (texto.length < 4) return null;

  const base = "https://nominatim.openstreetmap.org/search";
  let url =
    `${base}?format=json&limit=1&addressdetails=0&accept-language=pt-BR` +
    `&countrycodes=br&q=${encodeURIComponent(texto)}`;

  // Dá preferência a resultados perto da loja (quando informado)
  if (perto) {
    const d = 0.25; // ~25 km de viés ao redor da loja
    url +=
      `&viewbox=${perto.lng - d},${perto.lat + d},` +
      `${perto.lng + d},${perto.lat - d}&bounded=0`;
  }

  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error("Não foi possível consultar o endereço agora.");
  const dados = await resp.json();
  if (!Array.isArray(dados) || dados.length === 0) return null;

  const p = dados[0];
  const lat = parseFloat(p.lat);
  const lng = parseFloat(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: String(p.display_name || texto) };
}
