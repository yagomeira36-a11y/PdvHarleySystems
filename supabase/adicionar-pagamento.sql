BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
NOTIFY pgrst, 'reload schema';
COMMIT;
