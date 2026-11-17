BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS numero_pedido BIGINT;

WITH maximos AS (
  SELECT loja_id, COALESCE(MAX(numero_pedido), 0) AS ultimo_numero
  FROM public.orders
  GROUP BY loja_id
),
numerados AS (
  SELECT
    o.id,
    m.ultimo_numero + ROW_NUMBER() OVER (
      PARTITION BY o.loja_id
      ORDER BY o.created_at, o.id
    ) AS numero_pedido
  FROM public.orders o
  JOIN maximos m ON m.loja_id = o.loja_id
  WHERE o.numero_pedido IS NULL
)
UPDATE public.orders o
SET numero_pedido = n.numero_pedido
FROM numerados n
WHERE o.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS orders_loja_numero_pedido_uniq
  ON public.orders (loja_id, numero_pedido);

CREATE TABLE IF NOT EXISTS public.contadores_pedido (
  loja_id UUID PRIMARY KEY REFERENCES public.lojas(id) ON DELETE CASCADE,
  ultimo_numero BIGINT NOT NULL CHECK (ultimo_numero >= 0)
);

INSERT INTO public.contadores_pedido (loja_id, ultimo_numero)
SELECT loja_id, COALESCE(MAX(numero_pedido), 0)
FROM public.orders
GROUP BY loja_id
ON CONFLICT (loja_id) DO UPDATE
SET ultimo_numero = GREATEST(
  public.contadores_pedido.ultimo_numero,
  EXCLUDED.ultimo_numero
);

ALTER TABLE public.orders
  ALTER COLUMN numero_pedido SET NOT NULL;

CREATE OR REPLACE FUNCTION public.definir_numero_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.numero_pedido IS DISTINCT FROM OLD.numero_pedido THEN
      RAISE EXCEPTION 'O número do pedido não pode ser alterado.';
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO public.contadores_pedido (loja_id, ultimo_numero)
  VALUES (NEW.loja_id, 1)
  ON CONFLICT (loja_id) DO UPDATE
  SET ultimo_numero = public.contadores_pedido.ultimo_numero + 1
  RETURNING ultimo_numero INTO NEW.numero_pedido;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_definir_numero_pedido_insert ON public.orders;
CREATE TRIGGER orders_definir_numero_pedido_insert
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

DROP TRIGGER IF EXISTS orders_proteger_numero_pedido_update ON public.orders;
CREATE TRIGGER orders_proteger_numero_pedido_update
BEFORE UPDATE OF numero_pedido ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.definir_numero_pedido();

REVOKE ALL ON TABLE public.contadores_pedido FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.definir_numero_pedido() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
