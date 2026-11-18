"use client";

// ============================================================
// TELA DE LOGIN (SaaS PdvDaGalera)
// - E-mail + senha (sem botão de criar conta)
// - Senha errada -> "Acesso negado"
// - Loja vencida ou bloqueada -> /pagamento (só a tela do Asaas)
// - Credenciais do super admin também entram por aqui -> /admin
// - Visual azul igual à sidebar do sistema
// ============================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, salvarSessao, sha256Hex, Sessao } from "@/lib/supabase";
import { lojaSemAcesso } from "@/lib/acesso-loja";
import { ADMIN_EMAIL, ADMIN_SENHA } from "@/lib/admin";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (carregando) return;
    setErro(null);

    if (!email.trim() || !senha) {
      setErro("Informe e-mail e senha.");
      return;
    }

    // Credenciais do super admin nesta mesma tela -> painel /admin
    if (
      email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
      senha === ADMIN_SENHA
    ) {
      sessionStorage.setItem("menUAU_admin_ok", "1");
      router.replace("/admin");
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setErro("Banco de dados não configurado.");
      return;
    }

    setCarregando(true);
    // A senha é criptografada aqui no navegador (SHA-256) e o banco
    // só compara os códigos — sem depender do digest() do pgcrypto
    const hash = await sha256Hex(senha);
    const { data, error } = await supabase.rpc("login_loja_hash", {
      p_email: email.trim(),
      p_senha_hash: hash,
    });
    setCarregando(false);

    if (error && !error.message.includes("Could not find the function")) {
      setErro("Erro no banco: " + error.message);
      return;
    }

    // Se a função ainda não foi criada no banco, confere direto na
    // tabela "lojas" (mesma comparação de hash) — assim o login
    // funciona mesmo sem rodar nenhum SQL no Supabase
    let loja: Sessao | null = error ? null : (data as Sessao | null);
    if (!loja) {
      const { data: linha, error: erro2 } = await supabase
        .from("lojas")
        .select("id,nome_loja,email_dono,status_pagamento,data_vencimento,plano,senha_hash")
        .ilike("email_dono", email.trim())
        .maybeSingle();
      if (erro2) {
        setErro("Erro no banco: " + erro2.message);
        return;
      }
      if (linha && linha.senha_hash === hash) {
        loja = linha as Sessao;
      }
    }

    // E-mail/senha não conferem
    if (!loja) {
      setErro("Acesso negado");
      return;
    }

    salvarSessao(loja);

    // Loja vencida (data atingida), bloqueada ou com o admin marcando
    // como vencida -> entra, mas só na tela de pagamento do Asaas
    if (lojaSemAcesso(loja)) {
      router.replace("/pagamento");
    } else {
      router.replace("/pdv");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        {/* Caixa padrão enquanto o ícone da loja não for escolhido */}
        <div className="text-center mb-8">
          <div className="relative inline-block">
            <div className="bg-gradient-to-b from-gray-400 to-gray-600 rounded-2xl px-8 py-3 shadow-[0_4px_10px_rgba(0,0,0,0.3),inset_0_2px_3px_rgba(255,255,255,0.35)] border border-white/40">
              <p
                className="text-sm font-black leading-tight text-white"
                style={{
                  textShadow:
                    "1px 1px 0 #4b5563, 2px 2px 0 #374151, 3px 3px 0 #1f2937, 4px 4px 8px rgba(0,0,0,0.45)",
                }}
              >
                Escolha seu ícone no layout
              </p>
            </div>
            <div className="absolute -bottom-1.5 left-10 w-3.5 h-3.5 bg-gray-600 rotate-45 rounded-sm" />
          </div>
          <p className="text-sm text-gray-500 mt-4">Ponto de Venda &amp; KDS</p>
        </div>

        {/* Erro */}
        {erro && (
          <p className="bg-red-50 border border-red-400 text-red-600 rounded-lg p-3 text-sm font-semibold mb-4">
            {erro}
          </p>
        )}

        <form onSubmit={entrar} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@suafranquia.com"
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="w-full bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:opacity-90 disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl tracking-wide transition"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-[11px] text-gray-400 mt-6">
          Loja de demonstração: demo@menuau.com / 123456
        </p>
      </div>
    </div>
  );
}
