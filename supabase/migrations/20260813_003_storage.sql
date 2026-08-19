-- Create storage buckets for files & archives
INSERT INTO storage.buckets (id, name, public) 
VALUES 
    ('customer-files', 'customer-files', false),
    ('safevault_files', 'safevault_files', false),
    ('archive-files', 'archive-files', false),
    ('safevault_archives', 'safevault_archives', false)
ON CONFLICT (id) DO NOTHING;

-- Policy for storage objects
CREATE POLICY "Deny all public access" ON storage.objects FOR ALL USING (false);
