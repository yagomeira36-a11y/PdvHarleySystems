import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest, obterAdminRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_RPCS = new Set(["admin_atualizar_loja", "admin_obter_email", "admin_definir_login"]);
const LOJA_RPCS = new Set<string>([]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const fn = String(body?.fn ?? "");
    const args = (body?.args && typeof body.args === "object") ? body.args as Record<string, unknown> : {};
    if (!fn) return NextResponse.json({ data: null, error: { message: "RPC inválida" } }, { status: 400 });

    const admin = await obterAdminRequest(req);
    const sessao = await obterSessaoRequest(req);

    if (ADMIN_RPCS.has(fn)) {
      if (!admin) return NextResponse.json({ data: null, error: { message: "Não autorizado." } }, { status: 401 });
    } else if (LOJA_RPCS.has(fn)) {
      if (!sessao?.id) return NextResponse.json({ data: null, error: { message: "Não autorizado." } }, { status: 401 });
    } else {
      return NextResponse.json({ data: null, error: { message: "RPC não permitida." } }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { console.error("[PDV_DB]", { fn, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error("[PDV_RPC]", err);
    return erroGenerico(500);
  }
}
