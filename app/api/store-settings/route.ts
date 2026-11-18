import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const chavesPermitidas = new Set([
  "nome_loja", "categoria", "telefone_fixo", "whatsapp", "endereco", "maps_link",
  "instagram", "facebook", "banner_url", "logo_url", "cor_principal",
  "status_manual", "abre_as", "fecha_as", "horario_automatico",
  "entrega_min", "entrega_max", "retirada_min", "retirada_max",
  "permitir_entrega", "permitir_retirada",
  "apps",
  "horarios", "raios", "fora_raio_tipo", "delivery_center",
]);

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status });
}

function normalizar(value: unknown) {
  const objeto = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const saida: Record<string, unknown> = {};
  for (const chave of Array.from(chavesPermitidas)) {
    if (chave in objeto) saida[chave] = objeto[chave];
  }
  return saida;
}

async function encontrarLoja(req: NextRequest, lojaInformada?: string | null) {
  if (lojaInformada) return lojaInformada;
  const cookie = req.cookies.get("loja_sessao")?.value;
  if (!cookie) return null;
  try {
    return JSON.parse(decodeURIComponent(cookie)).id as string;
  } catch {
    try { return JSON.parse(cookie).id as string; } catch { return null; }
  }
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const lojaId = await encontrarLoja(req, req.nextUrl.searchParams.get("loja"));
  if (!supabase || !lojaId) return json({ error: "Loja não informada." }, 400);

  const store = await supabase.from("store_settings").select("*").eq("loja_id", lojaId).maybeSingle();
  if (!store.error && store.data) return json(store.data);

  const config = await supabase
    .from("configuracoes")
    .select("nome_empresa,telefone,endereco,whatsapp,logo_url,cardapio_aberto")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (config.error || !config.data) return json({});
  const data = config.data as Record<string, unknown>;
  const jsonConfig = await supabase
    .from("configuracoes")
    .select("store_settings_json")
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (!jsonConfig.error && jsonConfig.data?.store_settings_json && typeof jsonConfig.data.store_settings_json === "object") {
    return json(jsonConfig.data.store_settings_json);
  }
  return json({
    nome_loja: data.nome_empresa || "",
    telefone_fixo: data.telefone || "",
    endereco: data.endereco || "",
    whatsapp: data.whatsapp || data.telefone || "",
    logo_url: data.logo_url || "",
    status_manual: data.cardapio_aberto === false ? "fechado" : "aberto",
  });
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const lojaId = await encontrarLoja(req);
  if (!supabase || !lojaId) return json({ error: "Sessão da loja não encontrada." }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Dados inválidos." }, 400);
  const settings = normalizar(body);

  const banco = await supabase
    .from("store_settings")
    .upsert({ loja_id: lojaId, ...settings, updated_at: new Date().toISOString() }, { onConflict: "loja_id" });
  if (!banco.error) return json({ saved: true, source: "store_settings" });

  const configAtual = await supabase
    .from("configuracoes")
    .select("store_settings_json")
    .eq("loja_id", lojaId);
  if (configAtual.error) return json({ error: configAtual.error.message }, 400);

  const settingsSalvas =
    configAtual.data?.[0]?.store_settings_json &&
    typeof configAtual.data[0].store_settings_json === "object"
      ? configAtual.data[0].store_settings_json as Record<string, unknown>
      : {};
  const atualizacao: Record<string, unknown> = {
    store_settings_json: { ...settingsSalvas, ...settings },
  };
  const camposLegados: Record<string, string> = {
    nome_loja: "nome_empresa",
    telefone_fixo: "telefone",
    endereco: "endereco",
    abre_as: "abre_as",
    fecha_as: "fecha_as",
    horarios: "horario_semana",
    raios: "taxas_raio",
    apps: "links_apps",
    banner_url: "banner_url",
    logo_url: "logo_url",
    whatsapp: "whatsapp",
  };
  for (const [chave, coluna] of Object.entries(camposLegados)) {
    if (chave in settings) atualizacao[coluna] = settings[chave];
  }
  if ("status_manual" in settings) {
    atualizacao.cardapio_aberto = settings.status_manual !== "fechado";
  }

  const fallback = await supabase
    .from("configuracoes")
    .update(atualizacao)
    .eq("loja_id", lojaId);
  if (fallback.error) return json({ error: fallback.error.message }, 400);
  return json({ saved: true, source: "configuracoes" });
}
