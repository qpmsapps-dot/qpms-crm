import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { nativeThermographyPostgres } from './nativeThermographyPostgres.js';
export const actor = '00000000-0000-4000-8000-000000000001';
export const admin = '00000000-0000-4000-8000-000000000002';
const read = name => readFileSync(new URL('../../../' + name, import.meta.url), 'utf8');
export function oldMisFunction(name) {
  const sql = read('supabase/migrations/20261102071258_retail_mis_four_roles.sql');
  const start = sql.indexOf(`create function public.${name}(`), end = sql.indexOf('$$;', start);
  if (start < 0 || end < 0) throw Error('Reviewed installed function source is missing');
  return sql.slice(start, end + 3);
}
export async function correctionFixture() {
  const pg = await nativeThermographyPostgres(), db = pg.db;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table profiles(id uuid primary key,role text,designation text,department text,is_active boolean,status text,auth_user_id uuid,employee_code text);
      create table reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text,status text);
      create table retail_mis_assignments(profile_id uuid,auth_user_id uuid,employee_code text,role text,states text[],active boolean);
      insert into profiles values('${admin}','ADMIN',null,null,true,'Active','${admin}','ADMIN'),('${actor}','CENTRAL_MIS',null,null,true,'Active','${actor}','MIS');
      insert into retail_mis_assignments values('${actor}','${actor}','MIS','CENTRAL_MIS','{}',true);
      insert into reliance_retail_store_master select md5(i::text)::uuid,lpad(i::text,5,'0'),'Synthetic Store '||i,(array['TN','AP-1','AP-2','KA','KL','TG'])[1+(i%6)],'Active' from generate_series(1,3000) i;`);
    await db.exec(read('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql'));
    await db.exec(oldMisFunction('retail_mis_allowed') + oldMisFunction('retail_mis_unique_store') + oldMisFunction('rpc_retail_mis_attendance_commit'));
    await db.exec('revoke all on function rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text) from public,anon,authenticated;grant execute on function rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text) to service_role;');
    const client = await pg.connect(true);
    const stores = (await db.query('select * from reliance_retail_store_master order by store_code')).rows;
    const payload = (count, { days = 1, date = '2026-11-01', offset = 0 } = {}) => Array.from({ length: count }, (_, i) => {
      const employee = i % Math.ceil(count / days) + offset, store = stores[employee % 996];
      const day = Math.min(days - 1, Math.floor(i / Math.ceil(count / days)));
      return { employee_code: `SYN${employee}`, employee_name: 'Synthetic employee', retail_store_id: store.id, store_code: store.store_code,
        attendance_date: date.slice(0, 8) + String(Number(date.slice(8)) + day).padStart(2, '0'), class: employee % 3 ? 'HK' : 'MEPC',
        original_status: employee % 7 ? 'P' : 'HD', credit: employee % 7 ? 1 : 0.5, source_row: i + 2 };
    });
    const batch = async (rows, expected = [], uploader = actor) => {
      const id = randomUUID();
      await client.query(`insert into retail_attendance_uploads(id,kind,filename,checksum,uploaded_by,total_rows,valid_rows,rejected_rows,validation_summary,payload,expected_ids,raw_source)
        values($1::uuid,'attendance','synthetic.xlsx',$1::text,$2,$3,$3,0,'{"preview_key":"review-key"}',$4,$5,'{"retained":"original synthetic evidence"}')`, [id, uploader, rows.length, JSON.stringify(rows), JSON.stringify(expected.sort())]);
      return id;
    };
    const seed = async rows => {
      // Existing authorized commit path; no trigger/constraint disabling even for fixtures.
      const id = await batch(rows, [], admin);
      await client.query('select rpc_commit_retail_attendance_upload($1,$2,false,null,$3)', [id, admin, 'review-key']); return id;
    };
    const conflicts = async rows => (await client.query('select * from rpc_retail_attendance_conflicts($1)', [JSON.stringify(rows)])).rows;
    const commit = (id, connection = client, replace = true, reason = 'Verified synthetic correction') => connection.query('select rpc_retail_mis_attendance_commit($1,$2,$3,$4,$5)', [id, actor, replace, reason, 'review-key']);
    return { ...pg, db, client, payload, batch, seed, conflicts, commit, read };
  } catch (e) { await pg.close(); throw e; }
}
