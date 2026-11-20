"use client";

// ============================================================
// PAINEL SUPER ADMIN (/admin) — só o dono do sistema acessa
// - Login: admin@menUau.com + senha do código (lib/admin.ts) ou
//   o login salvo no banco, editável no botão "Login do Painel"
//   (depois de rodar supabase/admin-super-login.sql)
// - 3 cards: Total de Lojas, Em Dia, Atrasadas
// - Lista de lojas com status e botões de ação
// - "+ Nova Loja" cria a loja e o login dela na hora
// - "Editar Login" muda o e-mail e a senha do dono da loja
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, salvarSessao } from "@/lib/supabase";
import {
  ADMIN_EMAIL,
  validarLoginSuperAdmin,
  emailSuperAdmin,
  salvarLoginSuperAdmin,
} from "@/lib/admin";

type Loja = {
  id: string;
  nome_loja: string;
  email_dono: string;
  status_pagamento: string; // ativo | vencido | bloqueado
  data_vencimento: string | null;
  plano: string | null;
};

// Data de hoje em formato AAAA-MM-DD (horário local)
function hojeISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Data de daqui a 30 dias (próximo vencimento ao marcar como pago)
function daquiA30Dias(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// AAAA-MM-DD -> DD/MM/AAAA
function formatarDataBR(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// Status exibido: bloqueado (cinza) > vencido (vermelho) > ativo (verde)
// O dia do vencimento ainda conta como ativo; vence no dia seguinte.
function statusDe(loja: Loja): "ativo" | "vencido" | "bloqueado" {
  if (loja.plano === "demo") return "ativo"; // demo é isenta de mensalidade
  if (loja.status_pagamento === "bloqueado") return "bloqueado";
  if (loja.status_pagamento === "vencido") return "vencido";
  if (loja.data_vencimento && loja.data_vencimento < hojeISO()) return "vencido";
  return "ativo";
}

const STATUS_BADGE: Record<string, string> = {
  ativo: "bg-green-100 text-green-700",
  vencido: "bg-red-100 text-red-700",
  bloqueado: "bg-gray-200 text-gray-600",
};

const STATUS_TEXTO: Record<string, string> = {
  ativo: "ATIVO",
  vencido: "VENCIDO",
  bloqueado: "BLOQUEADO",
};

export default function Admin() {
  const router = useRouter();

  // ---- Login do super admin ----
  const [autenticado, setAutenticado] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState<string | null>(null);

  // ---- Painel ----
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  // ---- Modal + Nova Loja ----
  const [modalNova, setModalNova] = useState(false);
  const [formNova, setFormNova] = useState({ nome: "", email: "", cpfCnpj: "", senha: "", vencimento: "" });

  // ---- Modal Editar Vencimento ----
  const [modalVencimento, setModalVencimento] = useState<Loja | null>(null);
  const [novaData, setNovaData] = useState("");

  // ---- Modal Editar Login da Loja ----
  const [modalLoginLoja, setModalLoginLoja] = useState<Loja | null>(null);
  const [formLoginLoja, setFormLoginLoja] = useState({ email: "", senha: "" });

  // ---- Modal Editar Login do Painel (super admin) ----
  const [modalLoginPainel, setModalLoginPainel] = useState(false);
  const [formLoginPainel, setFormLoginPainel] = useState({ senhaAtual: "", email: "", novaSenha: "" });
  const [emailPainel, setEmailPainel] = useState(ADMIN_EMAIL);

  // Já está logado como admin nesta aba?
  useEffect(() => {
    if (sessionStorage.getItem("menUAU_admin_ok") === "1") setAutenticado(true);
  }, []);

  // Mostra o e-mail real do painel (banco se o SQL já foi rodado)
  useEffect(() => {
    emailSuperAdmin().then(setEmailPainel);
  }, []);

  // ============================================================
  // LOGIN DO SUPER ADMIN (banco se o SQL foi rodado; senão, o código)
  // ============================================================
  async function entrarAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErroLogin(null);
    const resultado = await validarLoginSuperAdmin(email, senha);
    if (resultado.ok) {
      sessionStorage.setItem("menUAU_admin_ok", "1");
      setAutenticado(true);
    } else {
      setErroLogin(resultado.erro ?? "Acesso negado");
    }
  }

  function sair() {
    sessionStorage.removeItem("menUAU_admin_ok");
    setAutenticado(false);
    setEmail("");
    setSenha("");
  }

  // ============================================================
  // CARREGAR LOJAS (só as do SaaS — email_dono preenchido)
  // ============================================================
  async function carregarLojas() {
    const supabase = getSupabase();
    if (!supabase) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data, error } = await supabase
      .from("lojas")
      .select("id,nome_loja,email_dono,status_pagamento,data_vencimento,plano")
      .not("email_dono", "is", null)
      .order("nome_loja");

    if (error) {
      // Tabela/colunas do SaaS ainda não existem -> SQL não foi rodado
      setLojas([]);
      setMensagem({
        tipo: "erro",
        texto:
          "Banco não configurado para o SaaS: rode o arquivo supabase/schema-saas.sql no SQL Editor do Supabase.",
      });
    } else {
      setLojas((data || []) as Loja[]);
    }
    setCarregando(false);
  }

  useEffect(() => {
    if (autenticado) carregarLojas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado]);

  // ============================================================
  // + NOVA LOJA
  // Chama a rota /api/admin/criar-loja, que no servidor:
  // 1. cria a loja (login + cardápio padrão)
  // 2. cria o cliente no Asaas
  // 3. cria a assinatura de R$ 49,99/mês
  // A chave do Asaas fica só no servidor.
  // ============================================================
  async function criarLoja(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;

    if (!formNova.nome.trim() || !formNova.email.trim() || !formNova.senha || !formNova.vencimento) {
      setMensagem({ tipo: "erro", texto: "Preencha todos os campos da nova loja." });
      return;
    }
    if (formNova.senha.length < 4) {
      setMensagem({ tipo: "erro", texto: "A senha inicial precisa de pelo menos 4 caracteres." });
      return;
    }
    // O Asaas exige CPF (11 dígitos) ou CNPJ (14 dígitos) para cobrar
    const cpfCnpj = formNova.cpfCnpj.replace(/\D/g, "");
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      setMensagem({
        tipo: "erro",
        texto: "Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do dono da loja.",
      });
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/admin/criar-loja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: formNova.nome.trim(),
          email: formNova.email.trim(),
          cpfCnpj,
          senha: formNova.senha,
          vencimento: formNova.vencimento,
        }),
      });
      const corpo = (await resposta.json()) as { erro?: string; aviso?: string | null };
      setSalvando(false);

      if (!resposta.ok) {
        setMensagem({ tipo: "erro", texto: corpo.erro ?? "Erro ao criar loja." });
        return;
      }

      if (corpo.aviso) {
        setMensagem({ tipo: "erro", texto: `Loja criada, mas: ${corpo.aviso}` });
      } else {
        setMensagem({ tipo: "ok", texto: `Loja "${formNova.nome.trim()}" criada com sucesso!` });
      }
      setModalNova(false);
      setFormNova({ nome: "", email: "", cpfCnpj: "", senha: "", vencimento: daquiA30Dias() });
      carregarLojas();
    } catch {
      setSalvando(false);
      setMensagem({ tipo: "erro", texto: "Não foi possível falar com o servidor." });
    }
  }

  function abrirNovaLoja() {
    setFormNova({ nome: "", email: "", cpfCnpj: "", senha: "", vencimento: daquiA30Dias() });
    setMensagem(null);
    setModalNova(true);
  }

  // ============================================================
  // AÇÕES DE CADA LOJA
  // ============================================================
  // Ver Loja: assume a sessão da loja e abre o PDV dela
  function verLoja(loja: Loja) {
    salvarSessao({
      id: loja.id,
      nome_loja: loja.nome_loja,
      email_dono: loja.email_dono,
      status_pagamento: loja.status_pagamento,
      data_vencimento: loja.data_vencimento,
      plano: loja.plano,
    });
    router.push("/pdv");
  }

  async function bloquear(loja: Loja) {
    if (salvando) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc("admin_atualizar_loja", {
      p_id: loja.id,
      p_status: "bloqueado",
    });
    setSalvando(false);
    if (error) {
      setMensagem({ tipo: "erro", texto: "Erro ao bloquear: " + error.message });
      return;
    }
    setMensagem({ tipo: "ok", texto: `Acesso de "${loja.nome_loja}" bloqueado.` });
    carregarLojas();
  }

  async function marcarPago(loja: Loja) {
    if (salvando) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc("admin_atualizar_loja", {
      p_id: loja.id,
      p_status: "ativo",
      p_vencimento: daquiA30Dias(),
    });
    setSalvando(false);
    if (error) {
      setMensagem({ tipo: "erro", texto: "Erro ao marcar como pago: " + error.message });
      return;
    }
    setMensagem({ tipo: "ok", texto: `Pagamento de "${loja.nome_loja}" registrado. Vencimento: ${formatarDataBR(daquiA30Dias())}.` });
    carregarLojas();
  }

  function abrirVencimento(loja: Loja) {
    setModalVencimento(loja);
    setNovaData(loja.data_vencimento ?? hojeISO());
    setMensagem(null);
  }

  async function salvarVencimento(e: React.FormEvent) {
    e.preventDefault();
    if (!modalVencimento || salvando) return;
    const supabase = getSupabase();
    if (!supabase) return;
    if (!novaData) {
      setMensagem({ tipo: "erro", texto: "Informe a nova data de vencimento." });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("admin_atualizar_loja", {
      p_id: modalVencimento.id,
      p_vencimento: novaData,
    });
    setSalvando(false);
    if (error) {
      setMensagem({ tipo: "erro", texto: "Erro ao editar vencimento: " + error.message });
      return;
    }
    setMensagem({ tipo: "ok", texto: `Vencimento de "${modalVencimento.nome_loja}" atualizado para ${formatarDataBR(novaData)}.` });
    setModalVencimento(null);
    carregarLojas();
  }

  // ============================================================
  // EDITAR LOGIN DA LOJA (e-mail e/ou senha do dono)
  // ============================================================
  function abrirLoginLoja(loja: Loja) {
    setFormLoginLoja({ email: loja.email_dono, senha: "" });
    setModalLoginLoja(loja);
    setMensagem(null);
  }

  async function salvarLoginLoja(e: React.FormEvent) {
    e.preventDefault();
    if (!modalLoginLoja || salvando) return;
    if (!formLoginLoja.email.trim()) {
      setMensagem({ tipo: "erro", texto: "Informe o e-mail do dono." });
      return;
    }
    setSalvando(true);
    try {
      const resposta = await fetch("/api/admin/editar-loja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: modalLoginLoja.id,
          email: formLoginLoja.email.trim(),
          senha: formLoginLoja.senha,
        }),
      });
      const corpo = (await resposta.json()) as { erro?: string; ok?: boolean; senhaAlterada?: boolean };
      if (!resposta.ok || !corpo.ok) {
        setMensagem({ tipo: "erro", texto: corpo.erro ?? "Erro ao salvar o login da loja." });
        return;
      }
      setMensagem({
        tipo: "ok",
        texto: `Login de "${modalLoginLoja.nome_loja}" atualizado${corpo.senhaAlterada ? " (e-mail e senha)" : " (e-mail)"}! O dono entra com o novo cadastro já a partir de agora.`,
      });
      setModalLoginLoja(null);
      carregarLojas();
    } catch {
      setMensagem({ tipo: "erro", texto: "Não foi possível falar com o servidor." });
    } finally {
      setSalvando(false);
    }
  }

  // ============================================================
  // EDITAR LOGIN DO PAINEL (super admin)
  // ============================================================
  async function abrirLoginPainel() {
    const atual = await emailSuperAdmin();
    setEmailPainel(atual);
    setFormLoginPainel({ senhaAtual: "", email: atual, novaSenha: "" });
    setModalLoginPainel(true);
    setMensagem(null);
  }

  async function salvarLoginPainel(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!formLoginPainel.senhaAtual) {
      setMensagem({ tipo: "erro", texto: "Informe a senha atual para confirmar a mudança." });
      return;
    }
    setSalvando(true);
    const resultado = await salvarLoginSuperAdmin({
      senhaAtual: formLoginPainel.senhaAtual,
      novoEmail: formLoginPainel.email,
      novaSenha: formLoginPainel.novaSenha,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setMensagem({ tipo: "erro", texto: resultado.erro ?? "Erro ao salvar o login do painel." });
      return;
    }
    const novoEmail = formLoginPainel.email.trim().toLowerCase();
    setEmailPainel(novoEmail);
    setModalLoginPainel(false);
    setMensagem({
      tipo: "ok",
      texto: `Login do painel salvo! Na próxima entrada use ${novoEmail}` +
        (formLoginPainel.novaSenha ? " com a nova senha." : "."),
    });
  }

  // ============================================================
  // ESTATÍSTICAS
  // ============================================================
  const emDia = lojas.filter((l) => statusDe(l) === "ativo").length;
  const atrasadas = lojas.filter((l) => statusDe(l) === "vencido").length;

  const inputClasse =
    "w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]";

  // ============================================================
  // TELA DE LOGIN DO ADMIN (antes de autenticar)
  // ============================================================
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white text-2xl font-extrabold mb-3">
              A
            </div>
            <p className="text-2xl font-extrabold text-gray-900 tracking-wide">
              Super Admin
            </p>
            <p className="text-sm text-gray-500">Ponto De Vendas Harley Systems</p>
          </div>

          {erroLogin && (
            <p className="bg-red-50 border border-red-400 text-red-600 rounded-lg p-3 text-sm font-semibold mb-4">
              {erroLogin}
            </p>
          )}

          <form onSubmit={entrarAdmin} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={emailPainel}
                autoFocus
                className={inputClasse}
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
                className={inputClasse}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:opacity-90 text-white font-extrabold py-3.5 rounded-xl tracking-wide transition"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================
  // PAINEL DO SUPER ADMIN
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      {/* Cabeçalho azul */}
      <header className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white px-6 py-5 flex items-center justify-between shadow-lg">
        <div>
          <h1 className="text-2xl font-extrabold tracking-wide">
            Painel Super Admin
          </h1>
          <p className="text-xs text-blue-200">Ponto De Vendas Harley Systems — gestão de lojas</p>
        </div>
        <button
          onClick={sair}
          className="bg-white/15 hover:bg-white/25 border border-white/30 text-white text-sm font-bold px-4 py-2 rounded-lg transition"
        >
          SAIR
        </button>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Mensagem de feedback */}
        {mensagem && (
          <div
            className={`rounded-lg p-3 mb-4 text-sm font-semibold ${
              mensagem.tipo === "ok"
                ? "bg-green-50 border border-green-500 text-green-700"
                : "bg-red-50 border border-red-400 text-red-600"
            }`}
          >
            {mensagem.texto}
          </div>
        )}

        {/* Cards de estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Total de Lojas
            </p>
            <p className="text-3xl font-extrabold text-[#2563EB]">{lojas.length}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Em Dia
            </p>
            <p className="text-3xl font-extrabold text-green-600">{emDia}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Atrasadas
            </p>
            <p className="text-3xl font-extrabold text-red-600">{atrasadas}</p>
          </div>
        </div>

        {/* Cabeçalho da lista + botões */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="font-bold text-lg">Lojas cadastradas</h2>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={abrirLoginPainel}
              className="bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 font-bold px-5 py-2.5 rounded-xl shadow-sm transition"
            >
              Login do Painel
            </button>
            <button
              onClick={abrirNovaLoja}
              className="bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-md shadow-green-600/20 transition"
            >
              + Nova Loja
            </button>
          </div>
        </div>

        {/* Tabela de lojas */}
        <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
          {carregando ? (
            <p className="text-gray-400 text-center py-10">Carregando lojas...</p>
          ) : lojas.length === 0 ? (
            <p className="text-gray-400 text-center py-10">
              Nenhuma loja cadastrada ainda. Clique em &quot;+ Nova Loja&quot;.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-left">
                  <th className="px-4 py-3 font-semibold">Nome da Loja</th>
                  <th className="px-4 py-3 font-semibold">Dono</th>
                  <th className="px-4 py-3 font-semibold">Vencimento</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lojas.map((loja) => {
                  const status = statusDe(loja);
                  return (
                    <tr key={loja.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold">{loja.nome_loja}</td>
                      <td className="px-4 py-3 text-gray-600">{loja.email_dono}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatarDataBR(loja.data_vencimento)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${STATUS_BADGE[status]}`}
                        >
                          {STATUS_TEXTO[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => verLoja(loja)}
                            className="bg-[#2563EB] hover:bg-[#1E40AF] text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Ver Loja
                          </button>
                          <button
                            onClick={() => bloquear(loja)}
                            disabled={salvando || loja.status_pagamento === "bloqueado"}
                            className="bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Bloquear Acesso
                          </button>
                          <button
                            onClick={() => marcarPago(loja)}
                            disabled={salvando}
                            className="bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-50 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Marcar como Pago
                          </button>
                          <button
                            onClick={() => abrirVencimento(loja)}
                            disabled={salvando}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Editar Vencimento
                          </button>
                          <button
                            onClick={() => abrirLoginLoja(loja)}
                            disabled={salvando}
                            className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 disabled:opacity-50 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                          >
                            Editar Login
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* ================= MODAL: + NOVA LOJA ================= */}
      {modalNova && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold mb-4">Nova Loja</h3>
            <form onSubmit={criarLoja} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Nome da Loja *
                </label>
                <input
                  type="text"
                  value={formNova.nome}
                  onChange={(e) => setFormNova({ ...formNova, nome: e.target.value })}
                  placeholder="Ex: Hamburgueria Centro"
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  E-mail do Dono *
                </label>
                <input
                  type="email"
                  value={formNova.email}
                  onChange={(e) => setFormNova({ ...formNova, email: e.target.value })}
                  placeholder="dono@loja.com"
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  CPF ou CNPJ do Dono *
                </label>
                <input
                  type="text"
                  value={formNova.cpfCnpj}
                  onChange={(e) => setFormNova({ ...formNova, cpfCnpj: e.target.value })}
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  className={inputClasse}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Obrigatório: o Asaas usa este documento para emitir a cobrança.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Senha Inicial *
                </label>
                <input
                  type="text"
                  value={formNova.senha}
                  onChange={(e) => setFormNova({ ...formNova, senha: e.target.value })}
                  placeholder="Mínimo 4 caracteres"
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Data de Vencimento *
                </label>
                <input
                  type="date"
                  value={formNova.vencimento}
                  onChange={(e) => setFormNova({ ...formNova, vencimento: e.target.value })}
                  className={inputClasse}
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition"
                >
                  {salvando ? "Criando..." : "Criar Loja"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalNova(false)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 rounded-xl text-sm font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDITAR VENCIMENTO ================= */}
      {modalVencimento && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-96 max-w-full">
            <h3 className="text-lg font-extrabold mb-1">Editar Vencimento</h3>
            <p className="text-sm text-gray-500 mb-4">{modalVencimento.nome_loja}</p>
            <form onSubmit={salvarVencimento} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Nova data de vencimento *
                </label>
                <input
                  type="date"
                  value={novaData}
                  onChange={(e) => setNovaData(e.target.value)}
                  className={inputClasse}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 bg-[#2563EB] hover:bg-[#1E40AF] disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalVencimento(null)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 rounded-xl text-sm font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDITAR LOGIN DA LOJA ================= */}
      {modalLoginLoja && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold mb-1">Editar Login da Loja</h3>
            <p className="text-sm text-gray-500 mb-4">{modalLoginLoja.nome_loja}</p>
            <form onSubmit={salvarLoginLoja} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  E-mail do Dono *
                </label>
                <input
                  type="email"
                  value={formLoginLoja.email}
                  onChange={(e) => setFormLoginLoja({ ...formLoginLoja, email: e.target.value })}
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Nova Senha
                </label>
                <input
                  type="text"
                  value={formLoginLoja.senha}
                  onChange={(e) => setFormLoginLoja({ ...formLoginLoja, senha: e.target.value })}
                  placeholder="Deixe vazio para manter a senha atual"
                  className={inputClasse}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Mínimo 4 caracteres. A senha atual continua valendo se este campo ficar vazio.
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition"
                >
                  {salvando ? "Salvando..." : "Salvar Login"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalLoginLoja(null)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 rounded-xl text-sm font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDITAR LOGIN DO PAINEL ================= */}
      {modalLoginPainel && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold mb-1">Login do Painel (Super Admin)</h3>
            <p className="text-sm text-gray-500 mb-4">
              Troque o e-mail e a senha de entrada do painel. Na próxima vez, entre com o novo login.
            </p>
            <form onSubmit={salvarLoginPainel} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Senha Atual *
                </label>
                <input
                  type="password"
                  value={formLoginPainel.senhaAtual}
                  onChange={(e) => setFormLoginPainel({ ...formLoginPainel, senhaAtual: e.target.value })}
                  placeholder="Comprove que você é o admin"
                  autoFocus
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  E-mail do Painel *
                </label>
                <input
                  type="email"
                  value={formLoginPainel.email}
                  onChange={(e) => setFormLoginPainel({ ...formLoginPainel, email: e.target.value })}
                  className={inputClasse}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Nova Senha
                </label>
                <input
                  type="text"
                  value={formLoginPainel.novaSenha}
                  onChange={(e) => setFormLoginPainel({ ...formLoginPainel, novaSenha: e.target.value })}
                  placeholder="Deixe vazio para manter a senha atual"
                  className={inputClasse}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Mínimo 4 caracteres. Se ficar vazio, só o e-mail muda.
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 bg-[#2563EB] hover:bg-[#1E40AF] disabled:opacity-50 text-white font-bold py-3 rounded-xl transition"
                >
                  {salvando ? "Salvando..." : "Salvar Login do Painel"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalLoginPainel(false)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 rounded-xl text-sm font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
