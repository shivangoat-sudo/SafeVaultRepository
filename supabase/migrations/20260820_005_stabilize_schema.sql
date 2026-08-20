-- SafeVault stabilization migration
-- Repairs schema drift without deleting application data.

-- Credentials must be one-to-one with an account. Do not delete or rewrite
-- existing credential rows here: duplicate data must be reconciled explicitly
-- after inspection of the live database before a UNIQUE constraint is added.
CREATE INDEX IF NOT EXISTS idx_credentials_account_id ON public.credentials(account_id);

-- Note attachment metadata is persisted directly on notes by the API.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- API writes updated_at when file metadata is edited.
ALTER TABLE public.file_metadata ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Legacy API compatibility: older server paths use user_id while the
-- canonical column is sender_id/uploader_id.
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.archive_files ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

-- Keep legacy and canonical actor columns synchronized for writes coming
-- from either API generation.
CREATE OR REPLACE FUNCTION public.sync_safevault_actor_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'communications' THEN
    IF NEW.sender_id IS NULL THEN NEW.sender_id := NEW.user_id; END IF;
    IF NEW.user_id IS NULL THEN NEW.user_id := NEW.sender_id; END IF;
  ELSIF TG_TABLE_NAME = 'archive_files' THEN
    IF NEW.uploader_id IS NULL THEN NEW.uploader_id := NEW.user_id; END IF;
    IF NEW.user_id IS NULL THEN NEW.user_id := NEW.uploader_id; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_communications_actor_columns ON public.communications;
CREATE TRIGGER sync_communications_actor_columns
BEFORE INSERT OR UPDATE ON public.communications
FOR EACH ROW EXECUTE FUNCTION public.sync_safevault_actor_columns();

DROP TRIGGER IF EXISTS sync_archive_files_actor_columns ON public.archive_files;
CREATE TRIGGER sync_archive_files_actor_columns
BEFORE INSERT OR UPDATE ON public.archive_files
FOR EACH ROW EXECUTE FUNCTION public.sync_safevault_actor_columns();

-- Backfill compatibility columns from canonical values.
UPDATE public.communications SET user_id = sender_id WHERE user_id IS NULL;
UPDATE public.archive_files SET user_id = uploader_id WHERE user_id IS NULL;

-- Ensure the intended owner defaults exist for a fresh installation.
INSERT INTO public.settings (
  id,
  max_customer_accounts_per_batch,
  max_upload_bytes,
  session_lifetime_hours,
  max_login_attempts,
  retention_years
)
VALUES (1, 500, 52428800, 5, 5, 7)
ON CONFLICT (id) DO NOTHING;
