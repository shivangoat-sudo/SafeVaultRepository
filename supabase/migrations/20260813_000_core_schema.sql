-- Core Schema for SafeVault

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number VARCHAR(20) UNIQUE NOT NULL, -- e.g. 89... for bookkeeper, 6... for customer
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'bookkeeper', 'customer')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    blocked_at TIMESTAMPTZ,
    owner_id UUID REFERENCES public.users(id) -- if a customer belongs to a bookkeeper/owner
);

-- 2. SESSIONS
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions(token_hash);

-- 3. TWO FACTOR CHALLENGES
CREATE TABLE IF NOT EXISTS public.two_factor_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_2fa_user ON public.two_factor_challenges(user_id, expires_at);

-- 4. SETTINGS
CREATE TABLE IF NOT EXISTS public.settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    max_customer_accounts_per_batch INTEGER NOT NULL DEFAULT 50,
    max_upload_bytes BIGINT NOT NULL DEFAULT 52428800,
    session_lifetime_hours INTEGER NOT NULL DEFAULT 5,
    max_login_attempts INTEGER NOT NULL DEFAULT 5,
    retention_years INTEGER NOT NULL DEFAULT 7
);

-- 5. NOTES
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    visible_to_customer BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_customer ON public.notes(customer_id);

-- 6. FILES
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(512) UNIQUE NOT NULL,
    category VARCHAR(50),
    quarter VARCHAR(10),
    year INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_files_customer ON public.files(customer_id);

-- 7. COMMUNICATIONS
CREATE TABLE IF NOT EXISTS public.communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    quarter VARCHAR(10),
    year INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. BTW CALCULATIONS
CREATE TABLE IF NOT EXISTS public.btw_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    calc_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    quarter VARCHAR(10) NOT NULL,
    year INTEGER NOT NULL,
    total_inc_21 NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_exc_21 NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_inc_9 NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_exc_9 NUMERIC(10, 2) NOT NULL DEFAULT 0,
    btw_to_reclaim NUMERIC(10, 2) NOT NULL DEFAULT 0,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS as defense in depth (Express server with service_role bypasses this by default, 
-- but it's good practice for direct DB access if ever enabled).
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- RPC for incrementing failed attempts safely
CREATE OR REPLACE FUNCTION increment_failed_attempts(user_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.users
    SET failed_attempts = failed_attempts + 1
    WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
