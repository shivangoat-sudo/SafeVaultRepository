CREATE TABLE IF NOT EXISTS public.archive_folders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.archive_folders(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.archive_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  uploader_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  folder_id uuid REFERENCES public.archive_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_path text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.archive_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('folder', 'file')),
  scope_id uuid NOT NULL,
  author_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dossier_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  quarter text NOT NULL,
  year integer NOT NULL,
  status text NOT NULL CHECK (status IN ('not_submitted', 'in_progress', 'done')),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(customer_id, quarter, year)
);
