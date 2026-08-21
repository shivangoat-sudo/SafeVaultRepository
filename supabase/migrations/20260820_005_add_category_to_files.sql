-- 1. Safely add the missing columns to public.files to align with migrations
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS quarter VARCHAR(10);
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES public.user_notes(id) ON DELETE SET NULL;

-- 2. Backfill uploader_id from user_id to prevent any null-constraint issues
UPDATE public.files SET uploader_id = user_id WHERE uploader_id IS NULL AND user_id IS NOT NULL;

