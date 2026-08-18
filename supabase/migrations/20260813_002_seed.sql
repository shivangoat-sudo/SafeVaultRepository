-- Seed data
-- Password hash for 'password' using bcrypt (cost 10)
-- $2a$10$XU.YJ/W/w4rR6O4JvO2R/OqR3O.5ZqUqQ7zQ.G9z/G1V3K1M.tE7e

INSERT INTO public.users (id, number, name, email, password_hash, role, status)
VALUES (
    uuid_generate_v4(),
    '123456',
    'Admin User',
    'admin@safevault.nl',
    '$2a$10$XU.YJ/W/w4rR6O4JvO2R/OqR3O.5ZqUqQ7zQ.G9z/G1V3K1M.tE7e',
    'owner',
    'active'
) ON CONFLICT (number) DO NOTHING;

INSERT INTO public.settings (id, max_customer_accounts_per_batch)
VALUES (1, 50)
ON CONFLICT (id) DO NOTHING;
