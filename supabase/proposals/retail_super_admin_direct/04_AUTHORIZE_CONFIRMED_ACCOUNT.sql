-- OWNER ONLY: fill the exact confirmed existing profile UUID. Never grant all Admin accounts.
begin;
do $grant$ declare target_id uuid:=null; source_sha text;begin
 if target_id is null then raise exception 'Set target_id to the Super Admin account UUID explicitly confirmed by the user';end if;
 if not public.retail_provisional_admin(target_id) then raise exception 'Existing active Admin account required';end if;
 select sha256 into strict source_sha from public.retail_provisional_files where version=2 and source_format='UNIFIED MASTER' and withdrawn_at is null;
 insert into public.retail_identity_final_authority(actor_id,source_sha256,authorization_reference) values(target_id,source_sha,'Super Admin final directive: direct Reliance Retail identity approval for confirmed Version 2') on conflict(actor_id,source_sha256) do nothing;
end;$grant$;commit;
