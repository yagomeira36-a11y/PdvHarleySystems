"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { lojaSemAcesso } from "@/lib/acesso-loja";

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

    setCarregando(true);
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), senha }),
      });
      const data = await resp.json().catch(() => null);

      if (!resp.ok) {
        setErro(typeof data?.error === "string" ? data.error : "Acesso negado");
        return;
      }

      if (data?.tipo === "admin") {
        sessionStorage.setItem("menUAU_admin_ok", "1");
        router.replace("/admin");
        return;
      }

      const loja = data?.sessao;
      if (loja && lojaSemAcesso(loja)) {
        router.replace("/pagamento");
      } else {
        router.replace("/pdv");
      }
    } catch {
      setErro("Não foi possível entrar. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <Image
            src="/harley-system-logo.jpeg"
            alt="Harley Systems"
            width={1153}
            height={768}
            className="mx-auto h-auto w-full max-w-xs"
            priority
          />
          <p className="text-sm text-gray-500 mt-4">
            Ponto De Vendas Harley Systems
          </p>
        </div>

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
              autoComplete="username"
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
              autoComplete="current-password"
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
          Problemas no acesso? Contate o suporte.
        </p>
      </div>
    </div>
  );
}
