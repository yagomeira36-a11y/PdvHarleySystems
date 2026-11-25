import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chavesPermitidas = new Set([
  "nome_loja", "categoria", "telefone_fixo", "whatsapp", "endereco", "maps_link",
  "instagram", "facebook", "banner_url", "logo_url", "cor_principal",
  "status_manual", "abre_as", "fecha_as", "horario_automatico",
  "entrega_min", "entrega_max", "retirada_min", "retirada_max",
  "permitir_entrega", "permitir_retirada",
  "apps", "horarios", "raios", "fora_raio_tipo", "delivery_center",
]);

const schema = z.record(z.string(), z.unknown()).transform((obj) => {
  const saida: Record<string, unknown> = {};
  for (const chave of chavesPermitidas) {
    if (chave in obj) saida[chave] = obj[chave];
  }
  return saida;
});

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status });
}

export async function GET(req: NextRequest) {
  try {
    const lojaId = req.nextUrl.searchParams.get("loja");
    if (!lojaId || !/^[0-9a-zA-Z-]{10,80}$/.test(lojaId)) return json({ error: "Loja não informada." }, 400);
    const supabase = getSupabaseAdmin();

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
  } catch (err) {
    console.error("[STORE_SETTINGS_GET]", err);
    return erroGenerico(500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const sessao = await obterSessaoRequest(req);
    if (!sessao?.id) return json({ error: "Sessão inválida ou expirada." }, 401);

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ error: "Dados inválidos." }, 400);
    const settings = parsed.data;
    if (Object.keys(settings).length === 0) return json({ error: "Nenhum campo válido informado." }, 400);

    const supabase = getSupabaseAdmin();
    const banco = await supabase
      .from("store_settings")
      .upsert({ loja_id: sessao.id, ...settings, updated_at: new Date().toISOString() }, { onConflict: "loja_id" });
    if (!banco.error) return json({ saved: true, source: "store_settings" });

    const configAtual = await supabase
      .from("configuracoes")
      .select("store_settings_json")
      .eq("loja_id", sessao.id);
    if (configAtual.error) return erroGenerico(400, "Não foi possível salvar as configurações.");

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
      .eq("loja_id", sessao.id);
    if (fallback.error) return erroGenerico(400, "Não foi possível salvar as configurações.");
    return json({ saved: true, source: "configuracoes" });
  } catch (err) {
    console.error("[STORE_SETTINGS_POST]", err);
    return erroGenerico(500);
  }
}
