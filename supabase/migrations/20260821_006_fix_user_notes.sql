-- Safely add the visible_to_customer column to public.user_notes
ALTER TABLE public.user_notes ADD COLUMN IF NOT EXISTS visible_to_customer BOOLEAN NOT NULL DEFAULT false;
