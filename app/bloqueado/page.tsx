"use client";

// ============================================================
// TELA /bloqueado — loja com mensalidade em atraso
// O login é negado e o usuário é avisado para falar com o suporte.
// ============================================================
import { useRouter } from "next/navigation";
import { limparSessao } from "@/lib/supabase";

export default function Bloqueado() {
  const router = useRouter();

  function voltar() {
    limparSessao();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
        {/* Ícone de cadeado */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 className="text-xl font-extrabold text-gray-900 mb-2">
          Acesso bloqueado
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Sua mensalidade está em atraso, entre em contato com o suporte.
        </p>

        <button
          onClick={voltar}
          className="w-full bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:opacity-90 text-white font-bold py-3 rounded-xl transition"
        >
          Voltar ao login
        </button>
      </div>
    </div>
  );
}
