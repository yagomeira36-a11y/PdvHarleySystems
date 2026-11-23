"use client";

import { useEffect, useRef, useState } from "react";
import { urlCardapioPublico } from "@/lib/cardapio-publico";
import { getSessao, normalizarTelefone } from "@/lib/supabase";
import DeliveryZonesMap from "./DeliveryZonesMap";

type StoreSettings = {
  nome_loja: string;
  categoria: string;
  telefone_fixo: string;
  whatsapp: string;
  endereco: string;
  maps_link: string;
  instagram: string;
  facebook: string;
  banner_url: string;
  logo_url: string;
  cor_principal: string;
  status_manual: "aberto" | "fechado";
  abre_as: string;
  fecha_as: string;
  horario_automatico: boolean;
  entrega_min: number;
  entrega_max: number;
  retirada_min: number;
  retirada_max: number;
  permitir_entrega: boolean;
  permitir_retirada: boolean;
  apps: {
    ifood: { ativo: boolean; link: string };
    food99: { ativo: boolean; link: string };
    keeta: { ativo: boolean; link: string };
    rappi: { ativo: boolean; link: string };
    outros: Array<{ id: string; nome: string; link: string; icone: string }>;
  };
  horarios: Record<"segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo", { ativo: boolean; abre: string; fecha: string }>;
  fora_raio_tipo: "nao_atender";
};

const APPS_VAZIOS: StoreSettings["apps"] = {
  ifood: { ativo: false, link: "" },
  food99: { ativo: false, link: "" },
  keeta: { ativo: false, link: "" },
  rappi: { ativo: false, link: "" },
  outros: [],
};

const HORARIOS_VAZIOS: StoreSettings["horarios"] = {
  segunda: { ativo: true, abre: "18:00", fecha: "23:00" },
  terca: { ativo: true, abre: "18:00", fecha: "23:00" },
  quarta: { ativo: true, abre: "18:00", fecha: "23:00" },
  quinta: { ativo: true, abre: "18:00", fecha: "23:00" },
  sexta: { ativo: true, abre: "18:00", fecha: "23:00" },
  sabado: { ativo: true, abre: "18:00", fecha: "23:00" },
  domingo: { ativo: false, abre: "18:00", fecha: "23:00" },
};

const VAZIO: StoreSettings = {
  nome_loja: "",
  categoria: "",
  telefone_fixo: "",
  whatsapp: "",
  endereco: "",
  maps_link: "",
  instagram: "",
  facebook: "",
  banner_url: "",
  logo_url: "",
  cor_principal: "#2E9E4A",
  status_manual: "aberto",
  abre_as: "00:00",
  fecha_as: "23:59",
  horario_automatico: false,
  entrega_min: 35,
  entrega_max: 50,
  retirada_min: 20,
  retirada_max: 35,
  permitir_entrega: true,
  permitir_retirada: true,
  apps: APPS_VAZIOS,
  horarios: HORARIOS_VAZIOS,
  fora_raio_tipo: "nao_atender",
};

export default function LojaOnline() {
  const sessao = getSessao();
  const [dados, setDados] = useState<StoreSettings>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const inputBanner = useRef<HTMLInputElement>(null);
  const inputLogo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function carregar() {
      if (!sessao) return;
      const resposta = await fetch("/api/store-settings", { cache: "no-store" });
      if (!resposta.ok) return;
      const salvo = await resposta.json();
      const camposLegados = new Set([
        "raios",
        "taxas_raio",
        "delivery_center",
        "taxa_entrega",
        "entrega_gratis_acima",
        "fora_raio_taxa",
      ]);
      const salvoAtual = Object.fromEntries(
        Object.entries(salvo).filter(([campo]) => !camposLegados.has(campo))
      ) as Partial<StoreSettings>;
      setDados({
        ...VAZIO,
        ...salvoAtual,
        horarios: { ...HORARIOS_VAZIOS, ...(salvo.horarios || {}) },
        fora_raio_tipo: "nao_atender",
        apps: {
          ...APPS_VAZIOS,
          ...(salvo.apps || {}),
          outros: Array.isArray(salvo.apps?.outros) ? salvo.apps.outros : [],
        },
      });
    }
    void carregar();
  }, [sessao?.id]);

  function alterar<K extends keyof StoreSettings>(campo: K, valor: StoreSettings[K]) {
    setDados((atual) => ({ ...atual, [campo]: valor }));
  }

  function escolherImagem(event: React.ChangeEvent<HTMLInputElement>, campo: "banner_url" | "logo_url") {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) { setMensagem("Escolha um arquivo de imagem."); return; }
    if (arquivo.size > 2 * 1024 * 1024) { setMensagem("A imagem deve ter até 2 MB."); return; }
    const leitor = new FileReader();
    leitor.onload = () => alterar(campo, String(leitor.result));
    leitor.readAsDataURL(arquivo);
  }

  function alterarAppPrincipal(app: "ifood" | "food99" | "keeta" | "rappi", campo: "ativo" | "link", valor: boolean | string) {
    setDados((atual) => ({
      ...atual,
      apps: {
        ...atual.apps,
        [app]: { ...atual.apps[app], [campo]: valor },
      },
    }));
  }

  function adicionarOutroApp() {
    setDados((atual) => ({
      ...atual,
      apps: {
        ...atual.apps,
        outros: [...atual.apps.outros, { id: crypto.randomUUID(), nome: "", link: "", icone: "" }],
      },
    }));
  }

  function alterarOutroApp(indice: number, campo: "nome" | "link" | "icone", valor: string) {
    setDados((atual) => ({
      ...atual,
      apps: {
        ...atual.apps,
        outros: atual.apps.outros.map((app, i) => i === indice ? { ...app, [campo]: valor } : app),
      },
    }));
  }

  function escolherIconeOutro(event: React.ChangeEvent<HTMLInputElement>, indice: number) {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;
    if (!arquivo.type.startsWith("image/")) { setMensagem("Escolha um arquivo de imagem."); return; }
    if (arquivo.size > 1 * 1024 * 1024) { setMensagem("O ícone deve ter até 1 MB."); return; }
    const leitor = new FileReader();
    leitor.onload = () => alterarOutroApp(indice, "icone", String(leitor.result));
    leitor.readAsDataURL(arquivo);
  }

  function alterarHorario(dia: keyof StoreSettings["horarios"], campo: "ativo" | "abre" | "fecha", valor: boolean | string) {
    setDados((atual) => ({
      ...atual,
      horarios: {
        ...atual.horarios,
        [dia]: { ...atual.horarios[dia], [campo]: valor },
      },
    }));
  }

  function copiarHorarioTodos() {
    const origem = dados.horarios.segunda;
    setDados((atual) => ({
      ...atual,
      horarios: Object.fromEntries(
        Object.keys(atual.horarios).map((dia) => [dia, { ...origem }])
      ) as StoreSettings["horarios"],
    }));
  }

  async function salvar() {
    if (!sessao) return;
    setSalvando(true);
    setMensagem("");
    const payload: StoreSettings = {
      ...dados,
      telefone_fixo: normalizarTelefone(dados.telefone_fixo),
      whatsapp: normalizarTelefone(dados.whatsapp),
    };
    const resposta = await fetch("/api/store-settings", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const resultado = await resposta.json().catch(() => null);
    setSalvando(false);
    if (!resposta.ok) setMensagem(resultado?.error || "Não foi possível salvar.");
    else {
      setMensagem("Loja online atualizada!");
    }
  }

  async function copiarLink() {
    if (!sessao) return;
    const link = urlCardapioPublico(sessao.id);
    if (!link) {
      setMensagem("Configure NEXT_PUBLIC_CARDAPIO_URL com a URL de produção para gerar o link público do cardápio.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setMensagem("Link copiado!");
    } catch {
      setMensagem(link);
    }
  }

  const link = sessao ? urlCardapioPublico(sessao.id) : "";
  const campo = "mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-black">Loja Online</h2><p className="text-sm text-gray-500">Tudo o que aparece no cardápio público.</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => void copiarLink()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold">Copiar link</button><a href={link || "#"} target="_blank" rel="noreferrer" aria-disabled={!link} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Abrir cardápio</a></div>
          </div>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Estamos em outros Apps / Peça também por</h3>
          <div className="space-y-3">
            {([
              ["ifood", "iFood", "bg-[#EA1D2C]"],
              ["food99", "99Food", "bg-[#FFCC00]"],
              ["keeta", "Keeta", "bg-[#00A86B]"],
              ["rappi", "Rappi", "bg-[#FF441F]"],
            ] as const).map(([chave, nome, cor]) => (
              <div key={chave} className="grid items-center gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[150px_100px_1fr]">
                <div className="flex items-center gap-2 font-bold">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs text-white ${cor}`}>{nome.slice(0, 2)}</span>{nome}
                </div>
                <button type="button" onClick={() => alterarAppPrincipal(chave, "ativo", !dados.apps[chave].ativo)} className={`rounded-full px-3 py-2 text-xs font-black ${dados.apps[chave].ativo ? "bg-green-600 text-white" : "bg-gray-200 text-gray-600"}`}>
                  {dados.apps[chave].ativo ? "LIGADO" : "DESLIGADO"}
                </button>
                <input value={dados.apps[chave].link} onChange={(e) => alterarAppPrincipal(chave, "link", e.target.value)} placeholder={`Link da minha loja no ${nome}`} className={campo} />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {dados.apps.outros.map((app, indice) => (
              <div key={app.id} className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[54px_1fr_1fr_40px]">
                <label className="flex h-12 w-12 cursor-pointer items-center justify-center overflow-hidden rounded-full border bg-gray-100 text-xs">
                  {app.icone ? <img src={app.icone} alt="" className="h-full w-full object-cover" /> : "+"}
                  <input type="file" accept="image/*" onChange={(e) => escolherIconeOutro(e, indice)} className="hidden" />
                </label>
                <input value={app.nome} onChange={(e) => alterarOutroApp(indice, "nome", e.target.value)} placeholder="Nome do app" className={campo} />
                <input value={app.link} onChange={(e) => alterarOutroApp(indice, "link", e.target.value)} placeholder="Link da loja" className={campo} />
                <button type="button" onClick={() => setDados((atual) => ({ ...atual, apps: { ...atual.apps, outros: atual.apps.outros.filter((_, i) => i !== indice) } }))} className="text-xl text-red-500">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={adicionarOutroApp} className="mt-3 rounded-lg border border-green-600 px-4 py-2 text-sm font-bold text-green-700">+ Adicionar outro app</button>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Dados da loja</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-bold">Nome da loja<input value={dados.nome_loja} onChange={(e) => alterar("nome_loja", e.target.value)} className={campo} /></label>
            <label className="text-sm font-bold">Categoria / Tipo<input value={dados.categoria} onChange={(e) => alterar("categoria", e.target.value)} placeholder="Pizzaria, Hamburgueria, Lanchonete" className={campo} /></label>
            <label className="text-sm font-bold">Telefone fixo<input value={dados.telefone_fixo} onChange={(e) => alterar("telefone_fixo", e.target.value)} className={campo} /></label>
            <label className="text-sm font-bold">WhatsApp (recebe pedidos)<input value={dados.whatsapp} onChange={(e) => alterar("whatsapp", e.target.value)} placeholder="5511999999999" className={campo} /></label>
            <label className="text-sm font-bold md:col-span-2">Endereço completo<input value={dados.endereco} onChange={(e) => alterar("endereco", e.target.value)} className={campo} /></label>
            <label className="text-sm font-bold md:col-span-2">Link do Google Maps<input value={dados.maps_link} onChange={(e) => alterar("maps_link", e.target.value)} placeholder="https://maps.google.com/..." className={campo} /></label>
            <label className="text-sm font-bold">Instagram<input value={dados.instagram} onChange={(e) => alterar("instagram", e.target.value)} placeholder="@loja ou link" className={campo} /></label>
            <label className="text-sm font-bold">Facebook<input value={dados.facebook} onChange={(e) => alterar("facebook", e.target.value)} placeholder="Link do Facebook" className={campo} /></label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Visual</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <div><label className="text-sm font-bold">Banner da loja</label>{dados.banner_url && <img src={dados.banner_url} alt="Banner" className="mt-2 h-24 w-full rounded-lg object-cover" />}<button type="button" onClick={() => inputBanner.current?.click()} className="mt-2 rounded-lg border px-3 py-2 text-sm font-bold">Enviar capa</button><input ref={inputBanner} type="file" accept="image/*" onChange={(e) => escolherImagem(e, "banner_url")} className="hidden" /></div>
            <div><label className="text-sm font-bold">Logo / Ícone</label>{dados.logo_url && <img src={dados.logo_url} alt="Logo" className="mt-2 h-20 w-20 rounded-full object-cover" />}<button type="button" onClick={() => inputLogo.current?.click()} className="mt-2 block rounded-lg border px-3 py-2 text-sm font-bold">Enviar logo</button><input ref={inputLogo} type="file" accept="image/*" onChange={(e) => escolherImagem(e, "logo_url")} className="hidden" /></div>
            <label className="text-sm font-bold">Cor principal<div className="mt-2 flex items-center gap-2"><input type="color" value={dados.cor_principal} onChange={(e) => alterar("cor_principal", e.target.value)} className="h-11 w-16 rounded border" /><input value={dados.cor_principal} onChange={(e) => alterar("cor_principal", e.target.value)} className={campo} /></div></label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Status e horário</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm font-bold">Status manual<select value={dados.status_manual} onChange={(e) => alterar("status_manual", e.target.value as "aberto" | "fechado")} className={campo}><option value="aberto">Aberto</option><option value="fechado">Fechado</option></select></label>
            <label className="text-sm font-bold">Abre às<input type="time" value={dados.abre_as} onChange={(e) => alterar("abre_as", e.target.value)} className={campo} /></label>
            <label className="text-sm font-bold">Fecha às<input type="time" value={dados.fecha_as} onChange={(e) => alterar("fecha_as", e.target.value)} className={campo} /></label>
            <label className="flex items-end gap-2 pb-2 text-sm font-bold"><input type="checkbox" checked={dados.horario_automatico} onChange={(e) => alterar("horario_automatico", e.target.checked)} className="h-4 w-4" />Abrir automaticamente</label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-black text-gray-900">Horário por dia da semana</h3>
            <button type="button" onClick={copiarHorarioTodos} className="rounded-lg border border-green-600 px-3 py-2 text-xs font-bold text-green-700">Copiar horário para todos os dias</button>
          </div>
          <div className="space-y-2">
            {([
              ["segunda", "Segunda"], ["terca", "Terça"], ["quarta", "Quarta"], ["quinta", "Quinta"],
              ["sexta", "Sexta"], ["sabado", "Sábado"], ["domingo", "Domingo"],
            ] as const).map(([dia, rotulo]) => (
              <div key={dia} className="grid items-center gap-2 rounded-xl border border-gray-200 p-3 md:grid-cols-[110px_110px_1fr_1fr]">
                <b className="text-sm">{rotulo}</b>
                <button type="button" onClick={() => alterarHorario(dia, "ativo", !dados.horarios[dia].ativo)} className={`rounded-full px-3 py-2 text-xs font-black ${dados.horarios[dia].ativo ? "bg-green-600 text-white" : "bg-gray-200 text-gray-600"}`}>{dados.horarios[dia].ativo ? "LIGADO" : "DESLIGADO"}</button>
                {dados.horarios[dia].ativo ? (
                  <>
                    <label className="text-xs font-bold">Abre às<input type="time" value={dados.horarios[dia].abre} onChange={(e) => alterarHorario(dia, "abre", e.target.value)} className={campo} /></label>
                    <label className="text-xs font-bold">Fecha às<input type="time" value={dados.horarios[dia].fecha} onChange={(e) => alterarHorario(dia, "fecha", e.target.value)} className={campo} /></label>
                  </>
                ) : <p className="md:col-span-2 text-sm font-bold text-red-600">Fechado</p>}
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-bold text-green-800">
            {(() => {
              const dias = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
              const hoje = dias[new Date().getDay()];
              const horario = dados.horarios[hoje];
              const rotulos: Record<(typeof dias)[number], string> = { domingo: "Domingo", segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta", sabado: "Sábado" };
              return horario.ativo
                ? `${rotulos[hoje]} - Aberto de ${String(horario.abre || "18:00").replace(":", "h")} às ${String(horario.fecha || "23:00").replace(":", "h")}`
                : `${rotulos[hoje]} - Fechado`;
            })()}
          </p>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Zonas de entrega</h3>
          <DeliveryZonesMap
            lojaId={getSessao()?.id ?? ""}
            enderecoLoja={dados.endereco}
          />
          <div className="mt-4 max-w-sm">
            <label className="text-sm font-bold">
              Fora do raio
              <select value={dados.fora_raio_tipo} disabled className={campo}>
                <option value="nao_atender">Não atender</option>
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 font-black text-gray-900">Entrega e retirada</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-bold">Entrega: mínimo (min)<input type="number" value={dados.entrega_min} onChange={(e) => alterar("entrega_min", Number(e.target.value))} className={campo} /></label>
            <label className="text-sm font-bold">Entrega: máximo (min)<input type="number" value={dados.entrega_max} onChange={(e) => alterar("entrega_max", Number(e.target.value))} className={campo} /></label>
            <label className="text-sm font-bold">Retirada: mínimo (min)<input type="number" value={dados.retirada_min} onChange={(e) => alterar("retirada_min", Number(e.target.value))} className={campo} /></label>
            <label className="text-sm font-bold">Retirada: máximo (min)<input type="number" value={dados.retirada_max} onChange={(e) => alterar("retirada_max", Number(e.target.value))} className={campo} /></label>
            <div className="flex gap-4 pt-7 text-sm font-bold"><label className="flex gap-2"><input type="checkbox" checked={dados.permitir_entrega} onChange={(e) => alterar("permitir_entrega", e.target.checked)} />Permitir entrega</label><label className="flex gap-2"><input type="checkbox" checked={dados.permitir_retirada} onChange={(e) => alterar("permitir_retirada", e.target.checked)} />Permitir retirada</label></div>
          </div>
        </section>

        {mensagem && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-800">{mensagem}</p>}
        <button type="button" disabled={salvando} onClick={() => void salvar()} className="w-full rounded-xl bg-green-600 px-5 py-3 font-black text-white disabled:opacity-50">{salvando ? "Salvando..." : "Salvar alterações"}</button>
      </div>
    </div>
  );
}
