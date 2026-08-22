CREATE TABLE IF NOT EXISTS public.customer_profile_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    field_key VARCHAR(255) NOT NULL,
    field_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(customer_id, field_key)
);

ALTER TABLE public.customer_profile_fields ENABLE ROW LEVEL SECURITY;
