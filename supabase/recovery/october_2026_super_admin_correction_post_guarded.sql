-- Requires the companion correction staging SQL.
-- Posts only through existing database financial guards; does not disable them.
CREATE OR REPLACE FUNCTION km_oct2026.post_correction(p_request_id bigint)
RETURNS TABLE(attendance_id uuid, old_km numeric, new_km numeric, old_petrol numeric, new_petrol numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,km_oct2026
AS $$
DECLARE req km_oct2026.correction_requests%ROWTYPE;
        a public.fo_attendance%ROWTYPE;
BEGIN
 IF session_user <> 'postgres' THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
 SELECT * INTO STRICT req FROM km_oct2026.correction_requests
 WHERE id=p_request_id FOR UPDATE;
 IF req.status <> 'STAGED' THEN RAISE EXCEPTION 'NOT_STAGED'; END IF;
 SELECT * INTO STRICT a FROM public.fo_attendance WHERE id=req.attendance_id FOR UPDATE;
 IF a.employee_code <> req.employee_code OR a.attendance_date <> req.attendance_date
 OR round(coalesce(a.total_approved_km,0)::numeric,2)<>round(req.expected_km,2)
 OR round(coalesce(a.petrol_amount,0)::numeric,2)<>round(req.expected_petrol,2)
 THEN RAISE EXCEPTION 'STALE_ATTENDANCE'; END IF;
 -- Protected financial update. Existing trigger guards remain active.
 UPDATE public.fo_attendance SET
 total_approved_km=req.proposed_km, petrol_amount=req.proposed_petrol,
 updated_at=now()
 WHERE id=req.attendance_id;
 UPDATE km_oct2026.correction_requests
 SET status='POSTED' WHERE id=p_request_id;
 attendance_id:=req.attendance_id;
 old_km:=req.expected_km; new_km:=req.proposed_km;
 old_petrol:=req.expected_petrol; new_petrol:=req.proposed_petrol;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION km_oct2026.post_correction(bigint)
 FROM PUBLIC,anon,authenticated,service_role;
