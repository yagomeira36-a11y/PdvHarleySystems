-- Adiciona os campos usados no cadastro e no cardápio online.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
