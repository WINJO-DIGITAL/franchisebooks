-- Which DPD sliding scale a franchise's vehicle is paid on. The value is the key of a scale saved in data/sliding-scales
-- (the file name without .json). Null means none chosen yet. The scales themselves live in the app, not the database.
alter table public.franchises add column if not exists sliding_scale_key text;
alter table public.franchises add constraint franchises_sliding_scale_key_format check (sliding_scale_key is null or sliding_scale_key ~ '^[a-z0-9][a-z0-9-]{0,79}$');
comment on column public.franchises.sliding_scale_key is 'Key of the DPD sliding scale chosen for this franchise (a file in data/sliding-scales). Null until chosen.';
