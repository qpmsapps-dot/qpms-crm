create or replace function public.retail_identity_only_approved(p_actor uuid,p_proof jsonb,p_code text,p_state text,p_name text,p_status text,p_ref text,p_evidence text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;e jsonb;m jsonb;
begin
 if p_proof is null or jsonb_typeof(p_proof) is distinct from 'object' then return false;end if;
 select * into p from public.retail_provisional_proposals where id=(p_proof->>'proposal_id')::uuid;
 if not found or p.kind<>'identity' or p.status<>'APPROVED' or p.target_store is not null or p.proposed_by=p.decided_by or p.decided_by is distinct from p_actor then return false;end if;
 select * into r from public.retail_provisional_rows where id=p.row_id;
 if not found then return false;end if;
 select * into f from public.retail_provisional_files where id=r.batch_id;
 if not found or f.withdrawn_at is not null then return false;end if;
 if jsonb_typeof(r.source->'issues') is distinct from 'array' then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then return false;end if;
 if (select count(*) from public.retail_provisional_rows other_row where other_row.batch_id=r.batch_id and upper(btrim(other_row.store_code))=upper(btrim(r.store_code)))<>1 then return false;end if;
 e:=p.decision_reason::jsonb;m:=p.changes->'activation_review';
 return coalesce(p.decided_at is not null and p.decided_at<=now() and p.proposed_by is not null and p.decided_by is not null
  and p.state=p_state and r.source_state=p_state and r.store_code=p_code
  and p.changes->>'state'=p_state and p.changes->>'store_name'=p_name and p.changes->>'operating_status'=p_status
  and p_status in ('Active','Inactive') and nullif(btrim(p_name),'') is not null
  and r.review->>'store_name'=p_name and r.review->>'operating_status'=p_status
  and r.verification_status='VERIFIED' and r.revision=p.revision+1
  and (p_proof->>'saved_row')::uuid=r.id and p_proof->>'source_sha256'=f.sha256 and p_proof->>'row_digest'=r.row_digest
  and (p_proof->>'source_version')::integer=f.version and (p_proof->>'source_row')::integer=r.source_row and (p_proof->>'source_revision')::integer=r.revision
  and m->>'schema'='saved_identity_review_v1' and m->>'operational_model'='IDENTITY_ONLY'
  and m->>'source_sha256'=f.sha256 and m->>'row_digest'=r.row_digest and (m->>'source_revision')::integer=p.revision
  and e->>'scope'='SAVED_SOURCE_IDENTITY' and e->>'reference'=p_ref and e->>'evidence_sha256'=p_evidence and p_evidence ~ '^[a-f0-9]{64}$',false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
revoke all on function public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text) from public,anon,authenticated,service_role;
