-- Owner-only October 2026 correction staging. Does not post or bypass existing guards.
CREATE SCHEMA IF NOT EXISTS km_oct2026;
CREATE TABLE IF NOT EXISTS km_oct2026.correction_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 attendance_id uuid NOT NULL REFERENCES public.fo_attendance(id),
 employee_code text NOT NULL,
 attendance_date date NOT NULL CHECK (attendance_date BETWEEN '2026-10-01' AND '2026-10-31'),
 expected_km numeric NOT NULL CHECK (expected_km >= 0),
 expected_petrol numeric NOT NULL CHECK (expected_petrol >= 0),
 add_km numeric NOT NULL CHECK (add_km >= 0),
 remove_km numeric NOT NULL CHECK (remove_km >= 0),
 proposed_km numeric NOT NULL CHECK (proposed_km >= 0),
 proposed_petrol numeric NOT NULL CHECK (proposed_petrol >= 0),
 evidence text NOT NULL CHECK (length(trim(evidence)) >= 10),
 reason text NOT NULL CHECK (length(trim(reason)) >= 15),
 status text NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED','CANCELLED','POSTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (round(proposed_km,2)=round(expected_km+add_km-remove_km,2))
);
ALTER TABLE km_oct2026.correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA km_oct2026 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON km_oct2026.correction_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX IF NOT EXISTS uq_staged_correction_attendance
 ON km_oct2026.correction_requests(attendance_id) WHERE status='STAGED';

CREATE OR REPLACE FUNCTION km_oct2026.stage_correction(
 p_id uuid, p_old_km numeric, p_old_petrol numeric,
 p_add numeric, p_remove numeric, p_new_petrol numeric,
 p_reason text, p_evidence text
) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,km_oct2026
AS $$
DECLARE a public.fo_attendance%ROWTYPE; new_id bigint;
BEGIN
 IF session_user <> 'postgres' THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
 IF p_old_km IS NULL OR p_old_petrol IS NULL OR p_add IS NULL OR p_remove IS NULL
 OR p_new_petrol IS NULL OR p_old_km<0 OR p_old_petrol<0 OR p_add<0
 OR p_remove<0 OR p_new_petrol<0 OR p_add+p_remove=0
 OR p_old_km+p_add-p_remove<0 OR length(trim(coalesce(p_reason,'')))<15
 OR length(trim(coalesce(p_evidence,'')))<10
 THEN RAISE EXCEPTION 'INVALID_CORRECTION'; END IF;
 SELECT * INTO STRICT a FROM public.fo_attendance WHERE id=p_id FOR UPDATE;
 IF a.attendance_date NOT BETWEEN '2026-10-01' AND '2026-10-31'
 THEN RAISE EXCEPTION 'OCTOBER_ONLY'; END IF;
 IF round(coalesce(a.total_approved_km,0)::numeric,2)<>round(p_old_km,2)
 OR round(coalesce(a.petrol_amount,0)::numeric,2)<>round(p_old_petrol,2)
 THEN RAISE EXCEPTION 'STALE_VALUES'; END IF;
 INSERT INTO km_oct2026.correction_requests(
 attendance_id,employee_code,attendance_date,expected_km,expected_petrol,
 add_km,remove_km,proposed_km,proposed_petrol,evidence,reason
 ) VALUES (a.id,a.employee_code,a.attendance_date,p_old_km,p_old_petrol,
 p_add,p_remove,round(p_old_km+p_add-p_remove,2),p_new_petrol,p_evidence,p_reason)
 RETURNING id INTO new_id;
 RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION km_oct2026.stage_correction(uuid,numeric,numeric,numeric,numeric,numeric,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
