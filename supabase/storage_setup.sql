-- ============================================================
-- GZCI File Dropbox — Supabase Storage Setup
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hvxxcqddqdtbllzrzeqf/sql
-- ============================================================

-- 1. Create the storage bucket (if not already done via UI)
-- NOTE: You can also create this in the Dashboard:
--   Storage → New Bucket → Name: "project-files" → Public: OFF
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,  -- 50MB limit
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'video/mp4', 'video/quicktime'
  ]
)
on conflict (id) do nothing;


-- 2. RLS POLICIES for storage.objects
-- Allow authenticated users to upload to their project folder
create policy "Authenticated users can upload to project-files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'project-files');

-- Allow authenticated users to read/download files
create policy "Authenticated users can download from project-files"
on storage.objects for select
to authenticated
using (bucket_id = 'project-files');

-- Allow full/admin roles to delete files
-- (Role is stored in user_metadata.role)
create policy "Full and admin users can delete from project-files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-files'
  and (auth.jwt() -> 'user_metadata' ->> 'role') in ('full', 'admin')
);

-- ============================================================
-- DONE. The React app uses signed URLs for downloads/previews
-- so no public access is needed on the bucket.
-- ============================================================
