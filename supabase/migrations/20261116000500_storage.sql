-- ════════════════════════════════════════════════════════════════════════════
-- Storage
-- Both buckets are private. There are deliberately NO storage policies for
-- end users: files are only read and written by the server (service role),
-- which checks the user's access first and then hands out short-lived signed
-- download links.
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('source-documents', 'source-documents', false, 26214400),
  ('reports', 'reports', false, 26214400),
  ('diagnostics', 'diagnostics', false, 10485760)
on conflict (id) do nothing;
