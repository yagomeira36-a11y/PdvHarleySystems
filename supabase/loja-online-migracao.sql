-- Execute este arquivo no SQL Editor do Supabase.

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS cardapio_aberto BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abre_as TEXT,
  ADD COLUMN IF NOT EXISTS fecha_as TEXT,
  ADD COLUMN IF NOT EXISTS horario_semana JSONB,
  ADD COLUMN IF NOT EXISTS taxas_raio JSONB,
  ADD COLUMN IF NOT EXISTS links_apps JSONB,
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS store_settings_json JSONB;

CREATE TABLE IF NOT EXISTS public.store_settings (
  loja_id UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  nome_loja TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  telefone_fixo TEXT,
  whatsapp TEXT,
  endereco TEXT,
  maps_link TEXT,
  instagram TEXT,
  facebook TEXT,
  banner_url TEXT,
  logo_url TEXT,
  cor_principal TEXT NOT NULL DEFAULT '#2E9E4A',
  status_manual TEXT NOT NULL DEFAULT 'aberto',
  abre_as TEXT NOT NULL DEFAULT '18:00',
  fecha_as TEXT NOT NULL DEFAULT '23:00',
  horario_automatico BOOLEAN NOT NULL DEFAULT false,
  horario_semana JSONB,
  horarios JSONB,
  entrega_min INTEGER NOT NULL DEFAULT 35,
  entrega_max INTEGER NOT NULL DEFAULT 50,
  retirada_min INTEGER NOT NULL DEFAULT 20,
  retirada_max INTEGER NOT NULL DEFAULT 35,
  taxa_entrega NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxas_raio JSONB,
  raios JSONB,
  entrega_gratis_acima NUMERIC(10,2) NOT NULL DEFAULT 0,
  fora_raio_tipo TEXT NOT NULL DEFAULT 'nao_atender',
  fora_raio_taxa NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_center JSONB,
  permitir_entrega BOOLEAN NOT NULL DEFAULT true,
  permitir_retirada BOOLEAN NOT NULL DEFAULT true,
  links_apps JSONB,
  apps JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS horario_semana JSONB,
  ADD COLUMN IF NOT EXISTS horarios JSONB,
  ADD COLUMN IF NOT EXISTS taxas_raio JSONB,
  ADD COLUMN IF NOT EXISTS raios JSONB,
  ADD COLUMN IF NOT EXISTS entrega_gratis_acima NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fora_raio_tipo TEXT NOT NULL DEFAULT 'nao_atender',
  ADD COLUMN IF NOT EXISTS fora_raio_taxa NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_center JSONB,
  ADD COLUMN IF NOT EXISTS links_apps JSONB,
  ADD COLUMN IF NOT EXISTS apps JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acesso_publico_store_settings" ON public.store_settings;
CREATE POLICY "acesso_publico_store_settings"
  ON public.store_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);
