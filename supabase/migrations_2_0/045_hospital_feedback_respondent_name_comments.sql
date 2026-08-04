-- 045: Hospital Feedback QR respondent name/comment support.
-- Additive only. Migration 044 has already been applied and must not be edited.
-- Length constraints are NOT VALID so historical rows remain compatible while
-- PostgreSQL still enforces the limits for new and updated rows.

alter table public.hospital_feedback_submissions
  add column if not exists respondent_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hospital_feedback_submissions_respondent_name_length'
      and conrelid = 'public.hospital_feedback_submissions'::regclass
  ) then
    alter table public.hospital_feedback_submissions
      add constraint hospital_feedback_submissions_respondent_name_length
      check (respondent_name is null or char_length(respondent_name) <= 120)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hospital_feedback_submissions_comments_length'
      and conrelid = 'public.hospital_feedback_submissions'::regclass
  ) then
    alter table public.hospital_feedback_submissions
      add constraint hospital_feedback_submissions_comments_length
      check (comments is null or char_length(comments) <= 2000)
      not valid;
  end if;
end $$;

comment on column public.hospital_feedback_submissions.respondent_name is
  'Optional respondent name supplied through the public Hospital Feedback QR form. Null for anonymous responses.';
comment on column public.hospital_feedback_submissions.comments is
  'Optional public feedback comment or suggestion. Render as plain text only.';
