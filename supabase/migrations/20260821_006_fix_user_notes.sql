-- Safely add the visible_to_customer column to public.notes
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS visible_to_customer BOOLEAN NOT NULL DEFAULT false;
