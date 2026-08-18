-- Create storage bucket for files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('safevault_files', 'safevault_files', false)
ON CONFLICT (id) DO NOTHING;

-- Since the backend uses service_role key to bypass RLS, we don't strictly need to write complex RLS policies for storage objects here. 
-- However, we can add a basic policy just in case the client ever accesses it directly.
CREATE POLICY "Deny all public access" ON storage.objects FOR ALL USING (false);
