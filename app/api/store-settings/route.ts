import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const chavesPermitidas = new Set([
  "nome_loja", "categoria", "telefone_fixo", "whatsapp", "endereco", "maps_link",
  "instagram", "facebook", "banner_url", "logo_url", "cor_principal",
  "status_manual", "abre_as", "fecha_as", "horario_automatico",
  "entrega_min", "entrega_max", "retirada_min", "retirada_max",
  "taxa_entrega", "permitir_entrega", "permitir_retirada",
  "apps",
  "horarios", "raios", "entrega_gratis_acima", "fora_raio_tipo", "fora_raio_taxa", "delivery_center",
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
    .select("nome_empresa,telefone,endereco,taxa_entrega_padrao,whatsapp,logo_url,cardapio_aberto")
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
    taxa_entrega: data.taxa_entrega_padrao || 0,
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

  const fallback = await supabase
    .from("configuracoes")
    .update({
      nome_empresa: String(settings.nome_loja || ""),
      telefone: String(settings.telefone_fixo || ""),
      endereco: String(settings.endereco || ""),
      taxa_entrega_padrao: Number(settings.taxa_entrega || 0),
    })
    .eq("loja_id", lojaId);
  if (fallback.error) return json({ error: fallback.error.message }, 400);
  await supabase
    .from("configuracoes")
    .update({ store_settings_json: settings })
    .eq("loja_id", lojaId);
  await supabase
    .from("configuracoes")
    .update({
      cardapio_aberto: settings.status_manual !== "fechado",
      abre_as: String(settings.abre_as || "18:00"),
      fecha_as: String(settings.fecha_as || "23:00"),
      horario_semana: settings.horarios || null,
      taxas_raio: settings.raios || null,
      links_apps: settings.apps || null,
      banner_url: String(settings.banner_url || ""),
      logo_url: String(settings.logo_url || ""),
      whatsapp: String(settings.whatsapp || ""),
    })
    .eq("loja_id", lojaId);
  return json({ saved: true, source: "configuracoes" });
}
