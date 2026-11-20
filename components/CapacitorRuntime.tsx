"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export default function CapacitorRuntime() {
  const pathname = usePathname();
  const [androidNative, setAndroidNative] = useState(false);
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let removeClickHandler: (() => void) | null = null;
    let removeBackButton: (() => Promise<void>) | null = null;

    async function configurarCapacitor() {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;
      const isAndroid = Capacitor.getPlatform() === "android";
      setAndroidNative(isAndroid);

      const [{ App }, { AppLauncher }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/app-launcher"),
      ]);
      if (disposed) return;

      const handleLinkClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest<HTMLAnchorElement>("a[href]");
        if (!anchor || anchor.hasAttribute("download")) return;

        let url: URL;
        try {
          url = new URL(anchor.href);
        } catch {
          return;
        }

        const opensNewWindow = anchor.target !== "" && anchor.target !== "_self";
        const isExternal = url.origin !== window.location.origin;
        if (
          !EXTERNAL_PROTOCOLS.has(url.protocol) ||
          (!opensNewWindow && !isExternal && !["mailto:", "tel:"].includes(url.protocol))
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        void AppLauncher.openUrl({ url: anchor.href }).catch((error) => {
          console.error("Não foi possível abrir o link no navegador externo:", error);
        });
      };

      document.addEventListener("click", handleLinkClick, true);
      removeClickHandler = () => document.removeEventListener("click", handleLinkClick, true);

      const backButton = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
          return;
        }
        void App.minimizeApp().catch((error) => {
          console.error("Não foi possível minimizar o aplicativo Android:", error);
        });
      });
      if (disposed) {
        await backButton.remove();
      } else {
        removeBackButton = () => backButton.remove();
      }

      if (!isAndroid) return;
      const { StatusBar } = await import("@capacitor/status-bar");
      await StatusBar.hide();

      if (!("serviceWorker" in navigator)) return;
      await navigator.serviceWorker.register("/capacitor-sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      if (!disposed) setServiceWorkerReady(true);
    }

    void configurarCapacitor().catch((error) => {
      console.error("Não foi possível configurar os recursos nativos do Capacitor:", error);
    });

    return () => {
      disposed = true;
      removeClickHandler?.();
      if (removeBackButton) {
        void removeBackButton().catch((error) => {
          console.error("Não foi possível remover o listener do botão Voltar:", error);
        });
      }
    };
  }, []);

  useEffect(() => {
    if (!androidNative || !serviceWorkerReady) return;
    let active = true;

    async function armazenarTelaAtual() {
      const registration = await navigator.serviceWorker.ready;
      if (!active) return;
      const resources = Array.from(
        document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          "script[src], link[rel='stylesheet'][href], link[rel='preload'][href]"
        )
      )
        .map((element) => {
          const value = "src" in element ? element.src : element.href;
          return new URL(value, window.location.href).href;
        })
        .filter((url) => new URL(url).origin === window.location.origin);

      (registration.active ?? registration.waiting)?.postMessage({
        type: "CACHE_SHELL",
        url: window.location.href,
        resources,
      });
    }

    void armazenarTelaAtual().catch((error) => {
      console.error("Não foi possível preparar a tela atual para uso offline:", error);
    });

    return () => {
      active = false;
    };
  }, [androidNative, pathname, serviceWorkerReady]);

  return null;
}
