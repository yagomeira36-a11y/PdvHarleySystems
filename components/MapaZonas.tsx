"use client";

// ============================================================
// MAPA DAS ZONAS DE ENTREGA (Leaflet + OpenStreetMap)
// Mostra a loja no centro (pin arrastável) e os círculos das
// zonas de entrega, um dentro do outro, cada um com sua cor e
// o valor da taxa em cima do círculo (estilo iFood).
// ============================================================
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as MapaLeaflet, LayerGroup } from "leaflet";
import { Zona, corZona, zonasOrdenadas } from "@/lib/zonas";

type Props = {
  lat: number; // posição da loja
  lng: number;
  zonas: Zona[];
  onMoverLoja: (lat: number, lng: number) => void; // ao arrastar o pin
  altura?: number; // altura do mapa em pixels
};

function formatarReal(valor: number): string {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

export default function MapaZonas({
  lat,
  lng,
  zonas,
  onMoverLoja,
  altura = 380,
}: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<MapaLeaflet | null>(null);
  const camadaRef = useRef<LayerGroup | null>(null);
  const moverRef = useRef(onMoverLoja);
  const [pronto, setPronto] = useState(false);

  // Mantém sempre a função mais recente de mover a loja
  useEffect(() => {
    moverRef.current = onMoverLoja;
  }, [onMoverLoja]);

  // Cria o mapa uma única vez
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelado || !divRef.current || mapaRef.current) return;

      const mapa = L.map(divRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([lat, lng], 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(mapa);

      camadaRef.current = L.layerGroup().addTo(mapa);
      mapaRef.current = mapa;

      // Recalcula o tamanho depois que o container é exibido
      setTimeout(() => mapa.invalidateSize(), 60);
      setPronto(true);
    })();

    return () => {
      cancelado = true;
      if (mapaRef.current) {
        mapaRef.current.remove();
        mapaRef.current = null;
        camadaRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desenha círculos das zonas + pin da loja (atualiza quando muda)
  useEffect(() => {
    if (!pronto) return;
    let ativo = true;
    (async () => {
      const L = (await import("leaflet")).default;
      const mapa = mapaRef.current;
      const camada = camadaRef.current;
      if (!ativo || !mapa || !camada) return;

      camada.clearLayers();

      const ordenadas = zonasOrdenadas(zonas).filter((zona) => zona.ativo);

      // Círculos (do maior para o menor, para o menor ficar por cima)
      [...ordenadas].reverse().forEach((z) => {
        const cor = z.cor || corZona(ordenadas.findIndex((x) => x.id === z.id));
        L.circle([lat, lng], {
          radius: z.raioKm * 1000, // metros
          color: cor,
          weight: 2,
          fillColor: cor,
          fillOpacity: 0.1,
        }).addTo(camada);

        // Etiqueta com o valor no topo do círculo (ponto invisível)
        const topoNorte: [number, number] = [lat + z.raioKm / 111.32, lng];
        L.circleMarker(topoNorte, {
          radius: 0,
          opacity: 0,
          fillOpacity: 0,
        })
          .addTo(camada)
          .bindTooltip(`${z.nome} • até ${z.raioKm} km • ${formatarReal(z.taxa)}`, {
            permanent: true,
            direction: "top",
            className: "zona-tooltip",
          });
      });

      // Pin arrastável da loja
      const icone = L.divIcon({
        className: "",
        html: '<div class="pin-loja">🏪</div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marcador = L.marker([lat, lng], {
        draggable: true,
        icon: icone,
        title: "Arraste para a posição da sua loja",
      }).addTo(camada);
      marcador.on("dragend", () => {
        const p = marcador.getLatLng();
        moverRef.current(p.lat, p.lng);
      });

      // Centraliza na loja
      mapa.setView([lat, lng]);
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, lat, lng, zonas]);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      <div ref={divRef} style={{ height: altura, width: "100%" }} />
    </div>
  );
}
