-- Core Schema for SafeVault

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ACCOUNTS (Primary User & Account Entity)
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number VARCHAR(20) UNIQUE NOT NULL, -- e.g. 89... for bookkeeper, 6... for customer, 2... for org
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'organization', 'user', 'customer')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    owner_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL, -- assigned bookkeeper, org, or owner
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
    totp_secret TEXT,
    last_2fa_verified_at TIMESTAMPTZ,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    blocked_at TIMESTAMPTZ,
    company_name VARCHAR(255),
    phone VARCHAR(50),
    kvk_number VARCHAR(50),
    btw_number VARCHAR(50),
    address VARCHAR(255),
    postal_code VARCHAR(20),
    city VARCHAR(100),
    profile JSONB DEFAULT '{}'::jsonb,
    temp_password TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON public.accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON public.accounts(owner_id);

-- 2. CREDENTIALS
CREATE TABLE IF NOT EXISTS public.credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credentials_account ON public.credentials(account_id);

-- 3. SESSIONS
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON public.sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions(token);

-- 4. TWO FACTOR CHALLENGES
CREATE TABLE IF NOT EXISTS public.two_factor_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    temp_token TEXT UNIQUE NOT NULL,
    temp_secret TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_2fa_account ON public.two_factor_challenges(account_id);
CREATE INDEX IF NOT EXISTS idx_2fa_token ON public.two_factor_challenges(temp_token);

-- 5. SETTINGS
CREATE TABLE IF NOT EXISTS public.settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    max_customer_accounts_per_batch INTEGER NOT NULL DEFAULT 50,
    max_upload_bytes BIGINT NOT NULL DEFAULT 52428800,
    session_lifetime_hours INTEGER NOT NULL DEFAULT 5,
    max_login_attempts INTEGER NOT NULL DEFAULT 5,
    retention_years INTEGER NOT NULL DEFAULT 7
);

-- 6. NOTES
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    visible_to_customer BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_customer ON public.notes(customer_id);

-- 7. FILES
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
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

-- 8. FILE METADATA
CREATE TABLE IF NOT EXISTS public.file_metadata (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    category VARCHAR(50),
    quarter VARCHAR(10),
    year INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_file_metadata_file ON public.file_metadata(file_id);

-- 9. COMMUNICATIONS
CREATE TABLE IF NOT EXISTS public.communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    quarter VARCHAR(10),
    year INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. BTW CALCULATIONS
CREATE TABLE IF NOT EXISTS public.btw_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
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

-- 11. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_account ON public.notifications(account_id);

-- 12. ADMIN STATUS / DOSSIER STATUS
CREATE TABLE IF NOT EXISTS public.admin_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    quarter VARCHAR(10) NOT NULL,
    year INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('not_submitted', 'in_progress', 'done')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, customer_id, quarter, year)
);

-- 13. ACCESS LOGS
CREATE TABLE IF NOT EXISTS public.access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    account_number VARCHAR(50),
    event VARCHAR(100) NOT NULL,
    ip VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. EMAIL TEMPLATES
CREATE TABLE IF NOT EXISTS public.email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. TRANSFER REQUESTS
CREATE TABLE IF NOT EXISTS public.transfer_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    receiver_user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_receiver',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- RPC for incrementing failed attempts safely
CREATE OR REPLACE FUNCTION increment_failed_attempts(acc_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.accounts
    SET failed_attempts = failed_attempts + 1
    WHERE id = acc_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
