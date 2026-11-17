import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { validarBytesEscPos } from "@/lib/escpos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PRINT_BYTES = 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 60_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETUP_MESSAGE = "QZ não configurado. Defina no servidor QZ_CERTIFICATE_PATH, QZ_PRIVATE_KEY_PATH e QZ_ALLOWED_PRINTERS (array JSON de nomes exatos). Impressão silenciosa exige certificado confiável no QZ Tray e sua chave privada correspondente; esta rota não gera certificados nem instala confiança.";
const CONFIG_ERROR = "Configuração QZ incompleta ou inválida. Revise as três variáveis QZ no servidor, a validade do certificado, a chave RSA correspondente (mínimo 2048 bits) e a lista de impressoras.";
const REQUEST_ERROR = "Solicitação QZ inválida ou fora da política de impressão local.";

class RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type JsonObject = Record<string, unknown>;
type Configuration = {
  certificate: string;
  privateKey: KeyObject;
  printers: Set<string>;
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new RouteError(400, REQUEST_ERROR);
}

function shortText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && !CONTROL_CHARACTERS.test(value);
}

function localSessionOnly(req: NextRequest, isPost: boolean): void {
  // A sessão demonstrativa exige uso local; o servidor também deve escutar somente no loopback.
  const url = req.nextUrl;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let hostUrl: URL;
  try {
    hostUrl = new URL(`${url.protocol}//${host}`);
  } catch {
    throw new RouteError(403, "Host local inválido.");
  }
  // Next 14 normaliza endereços de loopback; Origin deve coincidir com o Host original.
  const localHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !localHosts.includes(url.hostname) || !localHosts.includes(hostUrl.hostname) ||
    hostUrl.host !== host || hostUrl.port !== url.port ||
    req.headers.get("x-pdv-qz") !== "1" ||
    req.headers.get("sec-fetch-site") !== "same-origin" ||
    (isPost && origin === null) ||
    (origin !== null && origin !== hostUrl.origin)
  ) {
    throw new RouteError(403, "QZ permitido somente no PDV local, com requisição de mesma origem.");
  }

  try {
    const cookie = req.cookies.get("loja_sessao")?.value;
    if (!cookie || cookie.length > 8192) throw new Error();
    let session: unknown;
    try {
      session = JSON.parse(cookie); // NextRequest já decodifica cookies.
    } catch {
      session = JSON.parse(decodeURIComponent(cookie));
    }
    if (
      !isObject(session) || typeof session.id !== "string" || !UUID.test(session.id) ||
      session.status_pagamento !== "ativo"
    ) throw new Error();
  } catch {
    throw new RouteError(403, "Sessão local ausente, inválida ou bloqueada.");
  }
}

async function configuration(): Promise<Configuration | null> {
  // Apenas variáveis exclusivas do servidor; nunca aceitar caminhos da requisição.
  const certificatePath = process.env.QZ_CERTIFICATE_PATH;
  const privateKeyPath = process.env.QZ_PRIVATE_KEY_PATH;
  const allowedPrinters = process.env.QZ_ALLOWED_PRINTERS;
  if ([certificatePath, privateKeyPath, allowedPrinters].every((value) => !value?.trim())) return null;

  try {
    if (!certificatePath?.trim() || !privateKeyPath?.trim() || !allowedPrinters?.trim()) throw new Error();
    const names: unknown = JSON.parse(allowedPrinters);
    if (
      !Array.isArray(names) || names.length === 0 || names.length > 128 ||
      !names.every((name) => shortText(name, 256) && name.trim().length > 0) ||
      new Set(names).size !== names.length
    ) throw new Error();

    const [certificateBytes, privateKeyBytes] = await Promise.all([
      readFile(certificatePath),
      readFile(privateKeyPath),
    ]);
    const certificate = new X509Certificate(certificateBytes);
    const privateKey = createPrivateKey(privateKeyBytes);
    const now = Date.now();
    const from = Date.parse(certificate.validFrom);
    const until = Date.parse(certificate.validTo);
    if (
      !Number.isFinite(from) || !Number.isFinite(until) || now < from || now > until ||
      certificate.publicKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyType !== "rsa" ||
      (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !certificate.checkPrivateKey(privateKey)
    ) throw new Error();

    // Retornar somente o X509 público não comprova confiança no QZ Tray.
    return { certificate: certificate.toString(), privateKey, printers: new Set(names as string[]) };
  } catch {
    // Erros de filesystem/OpenSSL podem conter caminhos e material sensível.
    throw new RouteError(500, CONFIG_ERROR);
  }
}

async function readJsonLimited(req: NextRequest): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RouteError(415, "Envie application/json.");
  }
  const length = req.headers.get("content-length");
  if (length !== null) {
    requireValid(/^\d+$/.test(length));
    if (Number(length) > MAX_BODY_BYTES) throw new RouteError(413, "Corpo excede o limite de 2 MB.");
  }
  if (!req.body) throw new RouteError(400, REQUEST_ERROR);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RouteError(413, "Corpo excede o limite de 2 MB.");
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)));
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(400, REQUEST_ERROR);
  } finally {
    reader.releaseLock();
  }
}

// Defaults inertes do SDK: proibir opções capazes de mudar destino, comandos ou quantidade.
const SAFE_OPTIONS: Readonly<JsonObject> = {
  bounds: null,
  colorType: "color",
  copies: 1,
  density: 0,
  duplex: false,
  fallbackDensity: null,
  interpolation: "bicubic",
  legacy: false,
  margins: 0,
  orientation: null,
  paperThickness: null,
  printerTray: null,
  rasterize: false,
  rotation: 0,
  scaleContent: true,
  size: null,
  units: "in",
  forceRaw: false,
  altPrinting: false,
  encoding: "ISO-8859-1",
  spool: null,
};

function validateOptions(options: unknown): void {
  requireValid(isObject(options));
  requireValid(options.copies === 1 && options.encoding === "ISO-8859-1");
  requireValid(shortText(options.jobName, 128) && options.jobName.startsWith("PDVDG ") && options.jobName.trim().length > 6);
  for (const [key, value] of Object.entries(options)) {
    if (key === "jobName") continue;
    requireValid(Object.prototype.hasOwnProperty.call(SAFE_OPTIONS, key) && value === SAFE_OPTIONS[key]);
  }
}

function validatePrint(params: unknown, printers: Set<string>): void {
  requireValid(isObject(params) && onlyKeys(params, ["printer", "options", "data"]));
  requireValid(isObject(params.printer) && onlyKeys(params.printer, ["name"]));
  requireValid(typeof params.printer.name === "string" && printers.has(params.printer.name));
  validateOptions(params.options);
  requireValid(Array.isArray(params.data) && params.data.length >= 1 && params.data.length <= 2);
  let totalBytes = 0;
  for (const item of params.data) {
    requireValid(isObject(item) && onlyKeys(item, ["type", "format", "flavor", "data"]));
    requireValid(item.type === "raw" && item.format === "command" && item.flavor === "base64");
    requireValid(typeof item.data === "string" && item.data.length > 0 && item.data.length <= 4 * Math.ceil(MAX_PRINT_BYTES / 3));
    const bytes = Buffer.from(item.data, "base64");
    totalBytes += bytes.length;
    // Round-trip exige base64 canônico (inclusive padding), sem espaços/URLs/hex.
    requireValid(bytes.toString("base64") === item.data && bytes.length <= MAX_PRINT_BYTES && totalBytes <= MAX_PRINT_BYTES);
    requireValid(validarBytesEscPos(bytes));
  }
}

function validateRequest(request: string, printers: Set<string>): void {
  let payload: unknown;
  try {
    payload = JSON.parse(request);
  } catch {
    throw new RouteError(400, REQUEST_ERROR);
  }
  requireValid(isObject(payload) && onlyKeys(payload, ["call", "params", "timestamp"]));
  requireValid(typeof payload.timestamp === "number" && Number.isSafeInteger(payload.timestamp) && Math.abs(Date.now() - payload.timestamp) <= MAX_CLOCK_SKEW_MS);
  const params = payload.params;
  switch (payload.call) {
    case "printers.find":
      requireValid(isObject(params) && onlyKeys(params, ["query"]));
      requireValid(!Object.prototype.hasOwnProperty.call(params, "query") || shortText(params.query, 128));
      break;
    case "printers.startListening":
      requireValid(isObject(params) && onlyKeys(params, ["printerNames"]));
      requireValid(Array.isArray(params.printerNames) && params.printerNames.length > 0 && params.printerNames.length <= printers.size);
      requireValid(params.printerNames.every((name) => typeof name === "string" && printers.has(name)));
      requireValid(new Set(params.printerNames).size === params.printerNames.length);
      break;
    case "printers.detail":
    case "printers.stopListening":
    case "printers.getStatus":
      requireValid(params === undefined || params === null);
      break;
    case "print":
      validatePrint(params, printers);
      break;
    default:
      throw new RouteError(400, REQUEST_ERROR);
  }
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function failure(error: unknown): RouteError {
  return error instanceof RouteError ? error : new RouteError(500, "Não foi possível processar a solicitação QZ.");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    localSessionOnly(req, false);
    const config = await configuration();
    if (!config) return json({ configured: false, certificate: null, message: SETUP_MESSAGE });
    return json({
      configured: true,
      certificate: config.certificate,
      message: "Certificado e chave RSA válidos e correspondentes. Impressão silenciosa depende de este certificado ser confiável no QZ Tray; a rota não instala confiança. Uso exclusivo no PDV local, com sessão demonstrativa (não autenticação forte).",
    });
  } catch (error) {
    const problem = failure(error);
    return json({ configured: false, certificate: null, message: problem.message }, problem.status);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    localSessionOnly(req, true);
    const body = await readJsonLimited(req);
    requireValid(isObject(body) && onlyKeys(body, ["request"]) && typeof body.request === "string" && body.request.length > 0);
    const config = await configuration();
    if (!config) throw new RouteError(503, SETUP_MESSAGE);
    validateRequest(body.request, config.printers);
    // QZ assina o texto hexadecimal SHA-256 do JSON original, não os bytes do digest.
    const hex = createHash("sha256").update(body.request).digest("hex");
    const signature = sign("RSA-SHA512", Buffer.from(hex), config.privateKey).toString("base64");
    return json({ signature });
  } catch (error) {
    const problem = failure(error);
    return json({ message: problem.message }, problem.status);
  }
}
