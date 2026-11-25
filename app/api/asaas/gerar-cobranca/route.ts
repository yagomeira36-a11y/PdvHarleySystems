import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";
import { garantirVinculoAsaas, criarCobrancaMensalAsaas } from "@/lib/asaas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class LojaNaoEncontrada extends Error {}
type Resultado = { requerCpf: true } | { ok: true; cobranca: string };
const geracoes = new Map<string, Promise<Resultado>>();

export async function POST(req: NextRequest) {
  try {
    const sessao = await obterSessaoRequest(req);
    const corpo = await req.json().catch(() => null);
    const lojaId = typeof corpo?.loja === "string" ? corpo.loja : "";
    const cpfCnpj = typeof corpo?.cpfCnpj === "string" ? corpo.cpfCnpj.replace(/\D/g, "") : "";
    if (!sessao?.id || !lojaId || sessao.id !== lojaId) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
    if (cpfCnpj && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      return NextResponse.json({ erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let geracao = geracoes.get(lojaId);
    if (!geracao) {
      geracao = (async (): Promise<Resultado> => {
        const { data: loja, error } = await supabase
          .from("lojas")
          .select("id,nome_loja,email_dono,data_vencimento,asaas_customer_id,asaas_subscription_id")
          .eq("id", lojaId)
          .maybeSingle();
        if (error) throw new Error("Erro ao consultar a loja");
        if (!loja) throw new LojaNaoEncontrada("Loja não encontrada.");

        const vinculo = await garantirVinculoAsaas(loja, cpfCnpj);
        if ("requerCpf" in vinculo) return vinculo;

        if (loja.asaas_customer_id !== vinculo.clienteId || loja.asaas_subscription_id !== vinculo.assinaturaId) {
          const { error: erroSalvar } = await supabase.rpc("admin_salvar_asaas", {
            p_id: loja.id,
            p_customer_id: vinculo.clienteId,
            p_subscription_id: vinculo.assinaturaId,
          });
          if (erroSalvar) throw new Error("Não foi possível salvar o cadastro Asaas.");
        }

        const cobranca = await criarCobrancaMensalAsaas({
          clienteId: vinculo.clienteId,
          assinaturaId: vinculo.assinaturaId,
          lojaId: loja.id,
          vencimento: loja.data_vencimento ?? null,
        });
        return { ok: true, cobranca: cobranca.id };
      })();
      geracoes.set(lojaId, geracao);
      void geracao.finally(() => { if (geracoes.get(lojaId) === geracao) geracoes.delete(lojaId); }).catch(() => {});
    }

    const resultado = await geracao;
    if ("requerCpf" in resultado) {
      return NextResponse.json({ requerCpf: true, erro: "Informe o CPF/CNPJ do responsável para vincular esta loja." }, { status: 409 });
    }
    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[ASAAS_GERAR_COBRANCA]", err);
    return NextResponse.json({ erro: "Não foi possível gerar a cobrança." }, { status: err instanceof LojaNaoEncontrada ? 404 : 500 });
  }
}
