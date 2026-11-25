"use client";

import { useEffect, useState } from "react";
import {
  carregarDeliveryZones,
  corZona,
  configZonasVazia,
  geocodificar,
  lerZonas,
  novoIdZona,
  salvarDeliveryZones,
  zonasOrdenadas,
  type ConfigZonas,
  type Zona,
} from "@/lib/zonas";
import MapaZonas from "./MapaZonas";

type Props = {
  lojaId: string;
  enderecoLoja: string;
};

function numero(valor: string): number {
  return Number.parseFloat(valor.replace(",", ".")) || 0;
}

export default function DeliveryZonesMap({ lojaId, enderecoLoja }: Props) {
  const [config, setConfig] = useState<ConfigZonas>(configZonasVazia());
  const [buscaEndereco, setBuscaEndereco] = useState(enderecoLoja);
  const [raioNovo, setRaioNovo] = useState("");
  const [taxaNova, setTaxaNova] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const [mensagem, setMensagem] = useState("");

  useEffect(() => {
    setBuscaEndereco(enderecoLoja);
  }, [enderecoLoja]);

  useEffect(() => {
    let ativo = true;
    if (!lojaId) {
      setMensagem("Sessão da loja não encontrada.");
      setCarregando(false);
      return;
    }

    setCarregando(true);
    carregarDeliveryZones(lojaId)
      .then((zonas) => {
        if (ativo) setConfig(zonas);
      })
      .catch((erro: unknown) => {
        if (ativo) {
          setConfig(lerZonas(lojaId));
          setMensagem(
            erro instanceof Error
              ? erro.message
              : "Não foi possível carregar as zonas de entrega."
          );
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [lojaId]);

  async function gravar(novaConfig: ConfigZonas): Promise<boolean> {
    const anterior = config;
    setConfig(novaConfig);
    setSalvando(true);
    setMensagem("");
    try {
      await salvarDeliveryZones(lojaId, novaConfig);
      return true;
    } catch (erro) {
      setConfig(anterior);
      setMensagem(
        erro instanceof Error
          ? erro.message
          : "Não foi possível salvar as zonas de entrega."
      );
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function buscarEndereco() {
    if (!buscaEndereco.trim()) {
      setMensagem("Digite o endereço da sua loja.");
      return;
    }
    setBuscandoEndereco(true);
    setMensagem("");
    try {
      const resultado = await geocodificar(buscaEndereco, config);
      if (!resultado) {
        setMensagem("Endereço não encontrado. Inclua rua, número, bairro e cidade.");
        return;
      }
      if (await gravar({ ...config, lat: resultado.lat, lng: resultado.lng })) {
        setMensagem("Loja posicionada no mapa.");
      }
    } catch (erro) {
      setMensagem(
        erro instanceof Error ? erro.message : "Falha ao buscar o endereço."
      );
    } finally {
      setBuscandoEndereco(false);
    }
  }

  function editarZona(id: string, campo: keyof Zona, valor: string | boolean) {
    const zonas = config.zonas.map((zona) => {
      if (zona.id !== id) return zona;
      if (campo === "raioKm" || campo === "taxa") {
        return { ...zona, [campo]: numero(String(valor)) };
      }
      return { ...zona, [campo]: valor };
    });
    void gravar({ ...config, zonas });
  }

  function adicionarZona() {
    const raioKm = numero(raioNovo);
    const taxa = numero(taxaNova);
    if (raioKm <= 0) {
      setMensagem("Informe o raio da zona em KM (ex: 3).");
      return;
    }
    if (config.zonas.some((zona) => zona.raioKm === raioKm)) {
      setMensagem(`Já existe uma zona de até ${raioKm} km.`);
      return;
    }
    const maiorNumero = config.zonas.reduce((maior, zona) => {
      const numeroZona = Number(zona.nome.match(/\d+/)?.[0] || 0);
      return Math.max(maior, numeroZona);
    }, 0);
    const novaZona: Zona = {
      id: novoIdZona(),
      nome: `Zona ${maiorNumero + 1}`,
      cor: corZona(config.zonas.length),
      raioKm,
      taxa,
      ativo: true,
    };
    void gravar({ ...config, zonas: [...config.zonas, novaZona] });
    setRaioNovo("");
    setTaxaNova("");
  }

  function removerZona(id: string) {
    void gravar({
      ...config,
      zonas: config.zonas.filter((zona) => zona.id !== id),
    });
  }

  return (
    <div className="rounded-xl bg-white p-4">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label className="mb-1 block text-xs text-gray-500">
            Endereço da loja (centro do mapa)
          </label>
          <input
            type="text"
            value={buscaEndereco}
            onChange={(event) => setBuscaEndereco(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void buscarEndereco();
              }
            }}
            placeholder="Rua, número, bairro, cidade"
            className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void buscarEndereco()}
          disabled={buscandoEndereco || salvando || carregando}
          className="rounded-lg bg-blue-600 px-5 py-2 font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {buscandoEndereco ? "Buscando..." : "Localizar loja"}
        </button>
      </div>

      {carregando ?(
        <p className="py-10 text-center text-sm text-gray-400">
          Carregando zonas de entrega...
        </p>
      ) : (
        <>
          <MapaZonas
            lat={config.lat}
            lng={config.lng}
            zonas={config.zonas}
            onMoverLoja={(lat, lng) => void gravar({ ...config, lat, lng })}
          />
          <p className="mt-2 text-xs text-gray-400">
            Arraste o pin 🏪 para ajustar o centro. As alterações são salvas
            automaticamente e compartilhadas com o PDV e o cardápio online.
          </p>

          {config.zonas.length === 0 ?(
            <p className="my-4 text-sm text-gray-400">
              Nenhuma zona criada. Crie a primeira (ex.: até 3 km = R$ 5,00).
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Cor</th>
                    <th className="px-3 py-2">Zona</th>
                    <th className="px-3 py-2 text-right">Raio (KM)</th>
                    <th className="px-3 py-2 text-right">Valor (R$)</th>
                    <th className="px-3 py-2 text-center">Ativa</th>
                    <th className="px-3 py-2 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {zonasOrdenadas(config.zonas).map((zona, indice) => (
                    <tr
                      key={zona.id}
                      className={zona.ativo ? "" : "opacity-50"}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="color"
                          aria-label={`Cor da ${zona.nome}`}
                          value={zona.cor || corZona(indice)}
                          onChange={(event) =>
                            editarZona(zona.id, "cor", event.target.value)
                          }
                          disabled={salvando}
                          className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          defaultValue={zona.nome}
                          onBlur={(event) =>
                            editarZona(zona.id, "nome", event.target.value)
                          }
                          disabled={salvando}
                          className="w-24 rounded bg-gray-100 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          defaultValue={zona.raioKm}
                          onBlur={(event) =>
                            editarZona(zona.id, "raioKm", event.target.value)
                          }
                          disabled={salvando}
                          className="w-24 rounded bg-gray-100 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={zona.taxa}
                          onBlur={(event) =>
                            editarZona(zona.id, "taxa", event.target.value)
                          }
                          disabled={salvando}
                          className="w-24 rounded bg-gray-100 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={zona.ativo}
                          onChange={(event) =>
                            editarZona(zona.id, "ativo", event.target.checked)
                          }
                          disabled={salvando}
                          aria-label={`Ativar ${zona.nome}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removerZona(zona.id)}
                          disabled={salvando}
                          className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-40"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-xs text-gray-400">
            Altere raio e valor; os dados são salvos no mesmo lugar para o PDV e
            o cardápio online.
          </p>

          <div className="mt-4 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="text-xs text-gray-500">
              Raio da nova zona (KM)
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={raioNovo}
                onChange={(event) => setRaioNovo(event.target.value)}
                placeholder="Ex.: 3"
                disabled={salvando}
                className="mt-1 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-500">
              Valor da entrega (R$)
              <input
                type="number"
                min="0"
                step="0.01"
                value={taxaNova}
                onChange={(event) => setTaxaNova(event.target.value)}
                placeholder="Ex.: 5,00"
                disabled={salvando}
                className="mt-1 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={adicionarZona}
              disabled={!raioNovo.trim() || salvando || carregando}
              className="rounded-lg bg-green-600 px-5 py-2 font-bold text-white transition hover:bg-green-700 disabled:opacity-40"
            >
              Adicionar zona
            </button>
          </div>
        </>
      )}

      {salvando && (
        <p role="status" className="mt-3 text-xs text-gray-500">
          Salvando zonas compartilhadas...
        </p>
      )}
      {mensagem && (
        <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          {mensagem}
        </p>
      )}
    </div>
  );
}
