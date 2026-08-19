-- Seed data
-- Password hash for 'password' using bcrypt (cost 10)
-- $2a$10$XU.YJ/W/w4rR6O4JvO2R/OqR3O.5ZqUqQ7zQ.G9z/G1V3K1M.tE7e

INSERT INTO public.accounts (id, number, name, email, role, status)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '123456',
    'Admin User',
    'admin@safevault.nl',
    'owner',
    'active'
) ON CONFLICT (number) DO NOTHING;

INSERT INTO public.credentials (account_id, password_hash)
VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '$2a$10$XU.YJ/W/w4rR6O4JvO2R/OqR3O.5ZqUqQ7zQ.G9z/G1V3K1M.tE7e'
) ON CONFLICT DO NOTHING;

INSERT INTO public.settings (id, max_customer_accounts_per_batch, max_upload_bytes)
VALUES (1, 50, 52428800)
ON CONFLICT (id) DO NOTHING;
