import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { obterSessaoRequest, obterAdminRequest } from "@/lib/session";
import { erroGenerico } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Filter = { op: "eq"|"neq"|"in"|"not"|"gte"|"lte"|"gt"|"lt"|"ilike"; col: string; val: unknown; notOp?: string; notVal?: unknown };
type Body = {
  table?: string;
  action?: "select"|"insert"|"update"|"delete"|"upsert";
  select?: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Filter[];
  order?: { col: string; ascending?: boolean }[];
  limit?: number;
  range?: [number, number];
  single?: boolean;
  maybeSingle?: boolean;
  onConflict?: string;
};

const LOJA_TABLES = new Set([
  "products","orders","order_items","entregas","motoboys","fiados","clientes",
  "configuracoes","mesas","categorias_cardapio","store_settings"
]);
const ADMIN_TABLES = new Set(["lojas","admin_config","audit_logs"]);
const PUBLIC_READ_TABLES = new Set(["products","store_settings","configuracoes","categorias_cardapio","lojas"]);
const PUBLIC_LOJAS_COLS = new Set(["id","nome","nome_loja","slug"]);

function bad(msg: string, status = 400) { return NextResponse.json({ error: msg }, { status }); }

function applyFilters<T extends any>(q: T, filters: Filter[] | undefined): T {
  let cur: any = q;
  for (const f of filters ?? []) {
    if (!/^[a-zA-Z0-9_]+$/.test(f.col)) throw new Error("Filtro inválido");
    switch (f.op) {
      case "eq": cur = cur.eq(f.col, f.val); break;
      case "neq": cur = cur.neq(f.col, f.val); break;
      case "in": cur = cur.in(f.col, Array.isArray(f.val) ? f.val : []); break;
      case "gte": cur = cur.gte(f.col, f.val); break;
      case "lte": cur = cur.lte(f.col, f.val); break;
      case "gt": cur = cur.gt(f.col, f.val); break;
      case "lt": cur = cur.lt(f.col, f.val); break;
      case "ilike": cur = cur.ilike(f.col, String(f.val)); break;
      case "not": cur = cur.not(f.col, String(f.notOp ?? "is"), f.notVal ?? null); break;
      default: throw new Error("Operador inválido");
    }
  }
  return cur;
}

function sanitizeData(data: unknown): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map((d) => sanitizeObj(d));
  return sanitizeObj(data);
}
function sanitizeObj(d: unknown): Record<string, unknown> {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Dados inválidos");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_]+$/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return bad("Corpo inválido");
    const table = String(body.table ?? "");
    const action = body.action;
    if (!action || !["select","insert","update","delete","upsert"].includes(action)) return bad("Ação inválida");

    const admin = await obterAdminRequest(req);
    const sessao = await obterSessaoRequest(req);
    const isAdmin = !!admin;
    const lojaId = sessao?.id ?? null;

    const isPublicRead = !isAdmin && !lojaId && action === "select" && PUBLIC_READ_TABLES.has(table);
    if (!isAdmin && !lojaId && !isPublicRead) return bad("Não autorizado.", 401);
    if (isAdmin && !ADMIN_TABLES.has(table) && !LOJA_TABLES.has(table)) return bad("Tabela não permitida.", 403);
    if (!isAdmin && !LOJA_TABLES.has(table) && !isPublicRead) return bad("Tabela não permitida.", 403);

    const supabase = getSupabaseAdmin();
    let select = typeof body.select === "string" && body.select.length < 500 ? body.select : "*";
    if (isPublicRead && table === "lojas") {
      const cols = select.split(",").map((s) => s.trim()).filter((c) => PUBLIC_LOJAS_COLS.has(c));
      select = cols.length ? cols.join(",") : "id,nome_loja,slug";
    }

    if (action === "select") {
      if (isPublicRead && table === "lojas") {
        const hasIdOrSlug = (body.filters ?? []).some((f) => f.op === "eq" && ["id","slug"].includes(f.col) && String(f.val ?? ""));
        if (!hasIdOrSlug) return bad("Filtro obrigatório.", 400);
      }
      let q: any = supabase.from(table).select(select);
      q = applyFilters(q, body.filters);
      if (!isAdmin && LOJA_TABLES.has(table)) q = q.eq("loja_id", lojaId);
      for (const o of body.order ?? []) {
        if (!/^[a-zA-Z0-9_]+$/.test(o.col)) continue;
        q = q.order(o.col, { ascending: o.ascending !== false });
      }
      if (typeof body.limit === "number") q = q.limit(Math.max(1, Math.min(1000, body.limit)));
      if (Array.isArray(body.range) && body.range.length === 2) q = q.range(Number(body.range[0])||0, Number(body.range[1])||0);
      if (body.single) q = q.single();
      else if (body.maybeSingle) q = q.maybeSingle();
      const { data, error } = await q;
      if (error) { console.error("[PDV_DB]", { table: typeof table !== "undefined" ? table : undefined, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
      return NextResponse.json({ data, error: null });
    }

    if (isPublicRead) return bad("Não autorizado.", 401);

    if (action === "insert") {
      const raw = sanitizeData(body.data);
      const rows = Array.isArray(raw) ? raw : [raw];
      const scoped = rows.map((r) => (isAdmin ? r : { ...r, loja_id: lojaId }));
      let q: any = supabase.from(table).insert(scoped).select(select);
      if (body.single) q = q.single();
      if (body.maybeSingle) q = q.maybeSingle();
      const { data, error } = await q;
      if (error) { console.error("[PDV_DB]", { table: typeof table !== "undefined" ? table : undefined, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
      return NextResponse.json({ data, error: null });
    }

    if (action === "upsert") {
      const raw = sanitizeData(body.data);
      const rows = Array.isArray(raw) ? raw : [raw];
      const scoped = rows.map((r) => (isAdmin ? r : { ...r, loja_id: lojaId }));
      const opts = body.onConflict ? { onConflict: body.onConflict } : undefined;
      let q: any = supabase.from(table).upsert(scoped, opts).select(select);
      const { data, error } = await q;
      if (error) { console.error("[PDV_DB]", { table: typeof table !== "undefined" ? table : undefined, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
      return NextResponse.json({ data, error: null });
    }

    if (action === "update") {
      const raw = sanitizeObj(body.data);
      delete raw.loja_id;
      delete raw.id;
      let q: any = supabase.from(table).update(raw);
      q = applyFilters(q, body.filters);
      if (!isAdmin) q = q.eq("loja_id", lojaId);
      q = q.select(select);
      if (body.single) q = q.single();
      if (body.maybeSingle) q = q.maybeSingle();
      const { data, error } = await q;
      if (error) { console.error("[PDV_DB]", { table: typeof table !== "undefined" ? table : undefined, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
      return NextResponse.json({ data, error: null });
    }

    if (action === "delete") {
      let q: any = supabase.from(table).delete();
      q = applyFilters(q, body.filters);
      if (!isAdmin) q = q.eq("loja_id", lojaId);
      q = q.select(select);
      const { data, error } = await q;
      if (error) { console.error("[PDV_DB]", { table: typeof table !== "undefined" ? table : undefined, code: error.code, message: error.message }); return NextResponse.json({ data: null, error: { message: "Não foi possível concluir a operação." } }, { status: 400 }); }
      return NextResponse.json({ data, error: null });
    }

    return bad("Ação inválida");
  } catch (err) {
    console.error("[PDV_DATA]", err);
    return erroGenerico(500);
  }
}
