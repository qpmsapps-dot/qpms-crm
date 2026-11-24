import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { nativeThermographyPostgres } from './helpers/nativeThermographyPostgres.js';
import { attendanceTimeSource, summarizeAttendanceExceptions } from '../shared/retailAttendanceExceptions.js';
import { hydrateAttendanceExceptionTimes } from '../services/retailAttendanceExceptionSource.js';
import { encodeAttendanceSource } from '../services/retailAttendancePreviewAudit.js';
const file = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001', store = '00000000-0000-4000-8000-000000000002';
const time = attendanceTimeSource(['In Time', 'Out Time', 'Man Hours'], ['09:00:00', '', '0:00:00']);
const row = { employee_code: '0001', employee_name: 'Synthetic', retail_store_id: store, store_code: '0001', class: 'HK', original_status: 'P', credit: 1, attendance_date: '2026-11-21', source_row: 2, time_source: time };
test('native PostgreSQL17: additive proposal, existing commit fences, correction/concurrency, ACLs and bounded month performance', { timeout: 180000 }, async t => {
  const pg = await nativeThermographyPostgres();
  pg.query = pg.db.query; pg.exec = pg.db.exec;
  try {
    assert.match((await pg.query('show server_version')).rows[0].server_version, /^17\./);
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table public.profiles(id uuid primary key,role text,designation text,department text,is_active boolean);
      create table public.reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text,status text);
      insert into profiles values('${actor}','ADMIN',null,null,true);
      insert into reliance_retail_store_master values('${store}','0001','Synthetic','TN','Active');`);
    await pg.exec(file('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql'));
    const before = (await pg.query("select md5(pg_get_functiondef('rpc_commit_retail_attendance_upload(uuid,uuid,boolean,text,text)'::regprocedure)) hash")).rows[0].hash;
    const proposal = file('supabase/proposals/retail_attendance_exceptions_20261123.sql');
    await pg.exec(proposal); await pg.exec(proposal);
    assert.equal((await pg.query("select md5(pg_get_functiondef('rpc_commit_retail_attendance_upload(uuid,uuid,boolean,text,text)'::regprocedure)) hash")).rows[0].hash, before);
    const service = await pg.connect(true);
    const batch = async (payload, ids = [], archive = {}) => {
      const id = randomUUID();
      await service.query(`insert into retail_attendance_uploads(id,kind,filename,checksum,uploaded_by,total_rows,valid_rows,rejected_rows,validation_summary,payload,expected_ids,raw_source)
        values($1::uuid,'attendance','synthetic.xlsx',$1::text,$2,$3,$3,0,'{"preview_key":"key"}',$4,$5,$6)`, [id, actor, payload.length, JSON.stringify(payload), JSON.stringify(ids.sort()), JSON.stringify(archive)]);
      return id;
    };
    const commit = (connection, id, replace = false, reason = '') => connection.query('select rpc_commit_retail_attendance_upload($1,$2,$3,$4,$5)', [id, actor, replace, reason, 'key']);
    const source = async (ids = [store], classes = ['HK', 'MEPC'], from = '2026-11-21', to = '2026-11-21') =>
      (await service.query('select rpc_retail_attendance_exception_source($1,$2,$3,$4) rows', [ids, from, to, classes])).rows[0].rows;
    let first;
    await t.test('times survive existing immutable commit; replay adds no rows; browser database roles denied', async () => {
      first = await batch([row]); await commit(service, first); await commit(service, first);
      const rows = await source(); assert.equal(rows.length, 1); assert.deepEqual(rows[0].time_source, time);
      assert.equal(summarizeAttendanceExceptions(rows, { from: row.attendance_date, to: row.attendance_date, classes: ['HK'] }).missing_checkout, 1);
      for (const role of ['anon', 'authenticated']) {
        const c = await pg.connect(); await c.query('set role ' + role);
        await assert.rejects(() => c.query('select rpc_retail_attendance_exception_source($1,$2,$3)', [[store], row.attendance_date, row.attendance_date]), { code: '42501' });
        await assert.rejects(() => c.query('select * from retail_employee_daily_attendance'), { code: '42501' });
      }
      assert.deepEqual(await source([], ['HK']), []);
      assert.deepEqual(await source([store], ['MEPC']), []);
      await assert.rejects(() => source([store], ['unsupported']), { code: '22023' });
      await assert.rejects(() => source([store], ['HK'], '2026-10-01', '2026-11-21'), { code: '22023' });
    });
    await t.test('reasoned corrections supersede original times; failed correction rolls back; old payload N/A', async () => {
      const current = await source();
      const corrected = await batch([{ ...row, time_source: attendanceTimeSource(['In Time', 'Out Time', 'Man Hours'], ['09:00:00', '17:00:00', '8:00:00']) }], current.map(r => r.id));
      await assert.rejects(() => commit(service, corrected));
      assert.equal((await source())[0].batch_id, first);
      await commit(service, corrected, true, 'Verified corrected source');
      const out = summarizeAttendanceExceptions(await source(), { from: row.attendance_date, to: row.attendance_date, classes: ['HK'] });
      assert.equal(out.missing_checkout, 0); assert.equal(out.below_9_hours, 1);
      assert.equal(Number((await pg.query('select count(*) n from retail_employee_daily_attendance')).rows[0].n), 2);
      await assert.rejects(() => service.query('update retail_attendance_uploads set payload=\'[]\' where id=$1', [first]));
      const legacy = await batch([{ ...row, employee_code: 'LEGACY', source_row: 3, time_source: undefined }]); await commit(service, legacy);
      assert.equal(summarizeAttendanceExceptions(await source(), { from: row.attendance_date, to: row.attendance_date, classes: ['HK'] }).missing_checkout, null);
    });
    await t.test('independent sessions serialize racing retries and retain one current employee/date row', async () => {
      const a = await batch([{ ...row, employee_code: 'RACE' }]), b = await batch([{ ...row, employee_code: 'RACE' }]);
      const other = await pg.connect(true);
      const results = await Promise.allSettled([commit(service, a), commit(other, b)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.code, '40001');
      assert.equal((await source()).filter(r => r.employee_code === 'RACE').length, 1);
    });
    await t.test('old compressed committed source supplies verified punch data without any data update', async () => {
      const legacyRow = { ...row, employee_code: 'RECOVER', time_source: undefined };
      const original = { ...legacyRow, class: 'House Keeping', raw_cells: ['09:00:00', '', '0:00:00'], raw_formulas: {} };
      const archive = await encodeAttendanceSource({ headers: ['In Time', 'Out Time', 'Man Hours'], rows: [original] });
      const id = await batch([legacyRow], [], archive); await commit(service, id);
      const client = { from(table) {
        assert.equal(table, 'retail_attendance_uploads'); const filters = {};
        return { select() { return this; }, eq(k, v) { filters[k] = v; return this; }, async maybeSingle() {
          return { data: (await service.query('select id,kind,status,raw_source from retail_attendance_uploads where id=$1 and kind=$2 and status=$3', [filters.id, filters.kind, filters.status])).rows[0] };
        } };
      } };
      const current = (await source()).filter(r => r.batch_id === id);
      const recovered = await hydrateAttendanceExceptionTimes(client, current);
      assert.equal(summarizeAttendanceExceptions(recovered, { from: row.attendance_date, to: row.attendance_date, classes: ['HK'] }).missing_checkout, 1);
      assert.equal((await source()).find(r => r.batch_id === id).time_source, null);
      assert.deepEqual((await service.query('select payload from retail_attendance_uploads where id=$1', [id])).rows[0].payload, JSON.parse(JSON.stringify([legacyRow])));
    });
    await t.test('representative full-month 73,710-row read finishes under strict 8s SQL / 5s measured limit', async () => {
      const payload = Array.from({ length: 2457 * 30 }, (_, i) => ({ ...row, employee_code: `PERF${i % 2457}`, source_row: i + 2,
        attendance_date: `2026-10-${String(Math.floor(i / 2457) + 1).padStart(2, '0')}` }));
      // Import one normal daily workbook per transaction, as production does;
      // performance acceptance measures the month read, not a giant new importer.
      for (let i = 0; i < payload.length; i += 2457) {
        const id = await batch(payload.slice(i, i + 2457)); await commit(service, id);
      }
      const start = performance.now(), rows = await source([store], ['HK'], '2026-10-01', '2026-10-31');
      const ms = performance.now() - start;
      assert.equal(rows.length, payload.length); assert.ok(ms < 5000, `Exception source took ${ms.toFixed(1)}ms (limit 5000ms)`);
      t.diagnostic(`PostgreSQL17: ${rows.length} rows in ${ms.toFixed(1)}ms; strict statement_timeout 8s; read limit 5s.`);
    });
  } finally { await pg.close(); }
});
