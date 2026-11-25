import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  senha: z.string().min(1).max(200),
});

export const criarLojaSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  senha: z.string().min(4).max(200),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cpfCnpj: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v.length === 11 || v.length === 14, "CPF/CNPJ inválido"),
});

export const editarLojaSchema = z.object({
  id: z.string().uuid(),
  email: z.string().trim().email().max(200),
  senha: z.string().max(200).optional().default(""),
});

export const storeSettingsSchema = z.record(z.string(), z.unknown());
