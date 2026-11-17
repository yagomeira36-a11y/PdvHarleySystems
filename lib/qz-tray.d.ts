declare module "qz-tray" {
  type Config = { getPrinter(): { name: string }; getOptions(): Record<string, unknown> };
  export type PrinterEvent = { printerName: string; eventType?: string; statusText?: string; severity?: string; message?: string };
  export type PrinterDetails = { name: string; driver?: string; connection?: string };
  const qz: {
    api: { setSha256Type(handler: (data: string) => Promise<string>): void };
    security: {
      setCertificatePromise(handler: (resolve: (cert: string | null) => void, reject: (reason: unknown) => void) => void): void;
      setSignatureAlgorithm(algorithm: "SHA512"): void;
      setSignaturePromise(handler: (digest: string) => (resolve: (signature: string) => void, reject: (reason: unknown) => void) => void): void;
    };
    websocket: {
      isActive(): boolean;
      connect(options?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
      setClosedCallbacks(handler: () => void): void;
    };
    printers: {
      find(): Promise<string[]>;
      details(): Promise<PrinterDetails[]>;
      startListening(names: string[]): Promise<void>;
      stopListening(): Promise<void>;
      getStatus(): Promise<void>;
      setPrinterCallbacks(handler: (event: PrinterEvent) => void): void;
    };
    configs: { create(name: string, options?: { copies?: number; jobName?: string; encoding?: string }): Config };
    print(config: Config, data: { type: "raw"; format: "command"; flavor: "base64"; data: string }[]): Promise<void>;
  };
  export default qz;
}
