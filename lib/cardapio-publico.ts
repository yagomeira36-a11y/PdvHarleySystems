export function baseUrlCardapioPublico(): string {
  const configurada = process.env.NEXT_PUBLIC_CARDAPIO_URL?.trim().replace(/\/+$/, "");
  if (typeof window === "undefined") return configurada || "";

  const host = window.location.hostname;
  const protocol = window.location.protocol;
  const localHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0";

  const w = window as unknown as {
    electron?: unknown;
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  const emElectron =
    Boolean(w.electron) ||
    /electron/i.test(navigator.userAgent) ||
    navigator.userAgent.toLowerCase().includes(" electron/");

  const plataformaCapacitor = w.Capacitor?.getPlatform?.();
  const emCapacitor =
    Boolean(w.Capacitor?.isNativePlatform?.()) ||
    plataformaCapacitor === "android" ||
    plataformaCapacitor === "ios" ||
    protocol === "capacitor:" ||
    protocol === "ionic:" ||
    protocol === "file:";

  const emTauri = Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);

  if (configurada && (localHost || emElectron || emCapacitor || emTauri)) {
    return configurada;
  }

  // Link público do cardápio: sempre preferir URL de produção quando configurada.
  if (configurada) return configurada;

  if (localHost || emElectron || emCapacitor || emTauri) {
    return "";
  }

  return window.location.origin.replace(/\/+$/, "");
}

export function urlCardapioPublico(lojaId: string): string {
  const base = baseUrlCardapioPublico();
  if (!base) return "";
  return `${base}/cardapio?loja=${encodeURIComponent(lojaId)}`;
}
