import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { correctionFixture, actor } from './helpers/retailAttendanceCorrectionFixture.js';
test('native PostgreSQL17 correction atomicity, permissions, full snapshots, performance and recovery', { timeout: 180000 }, async t => {
  const f = await correctionFixture();
  try {
    assert.match((await f.db.query('show server_version')).rows[0].server_version, /^17\./);
    const fingerprints = (await f.db.query("select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where pronamespace='public'::regnamespace and proname in ('rpc_commit_retail_attendance_upload','retail_attendance_daily_cap','retail_attendance_source_immutable','retail_mis_allowed','retail_mis_unique_store') order by proname")).rows;
    const day = f.payload(2468); await f.seed(day.slice(0, 2446));
    const oldMatches = await f.conflicts(day), truncated = await f.batch(day, oldMatches.slice(0, 1000).map(r => r.id));
    await assert.rejects(() => f.commit(truncated), { code: '40001' });
    const proposal = f.read('supabase/proposals/retail_attendance_correction_commit_20261124.sql');
    await f.db.exec(proposal); await f.db.exec(proposal);
    assert.deepEqual((await f.db.query("select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where pronamespace='public'::regnamespace and proname in ('rpc_commit_retail_attendance_upload','retail_attendance_daily_cap','retail_attendance_source_immutable','retail_mis_allowed','retail_mis_unique_store') order by proname")).rows, fingerprints);
    const snapshot = async rows => (await f.client.query('select rpc_retail_attendance_conflict_snapshot($1) s', [JSON.stringify(rows)])).rows[0].s;
    const status = async (id, connection = f.client, who = actor) => (await connection.query('select rpc_retail_mis_attendance_status($1,$2,$3) s', [id, who, 'review-key'])).rows[0].s;
    const state = async id => (await f.db.query('select status from retail_attendance_uploads where id=$1', [id])).rows[0].status;
    let committedDay;
    await t.test('complete snapshot exceeds PostgREST row limit and old partial preview remains denied', async () => {
      const s = await snapshot(day); assert.equal(s.count, 2446); assert.equal(s.records.length, 2446);
      assert.deepEqual(s.records.map(r => r.id), oldMatches.map(r => r.id));
      await assert.rejects(() => f.commit(truncated), { code: '40001' });
      assert.equal(await state(truncated), 'preview');
    });
    await t.test('single-day 2,468-row correction: original evidence, HK/MEPC, half credits and other dates preserved', async () => {
      const untouched = await f.seed(f.payload(10, { date: '2026-11-10', offset: 50000 }));
      const before = (await f.db.query('select * from retail_employee_daily_attendance where batch_id=$1 order by id', [untouched])).rows;
      const s = await snapshot(day), id = await f.batch(day, s.records.map(r => r.id));
      const started = performance.now(); await f.commit(id); const ms = performance.now() - started;
      assert.ok(ms < 3000, `Single-day commit ${ms.toFixed(1)}ms exceeds 3s`); t.diagnostic(`Single-day: 2468 records / 2446 corrections in ${ms.toFixed(1)}ms`);
      const rows = (await f.db.query('select * from retail_employee_daily_attendance where batch_id=$1', [id])).rows;
      assert.equal(rows.length, 2468); assert.equal(await state(id), 'committed');
      assert.deepEqual(rows.map(r => [r.employee_code, r.class, Number(r.credit), r.original_status]).sort(), day.map(r => [r.employee_code, r.class, r.credit, r.original_status]).sort());
      assert.equal(Number((await f.db.query('select count(*) n from retail_employee_daily_attendance where superseded_by_batch=$1', [id])).rows[0].n), 2446);
      assert.deepEqual((await f.db.query('select * from retail_employee_daily_attendance where batch_id=$1 order by id', [untouched])).rows, before);
      const audit = (await f.db.query('select raw_source,correction_reason from retail_attendance_uploads where id=$1', [id])).rows[0];
      assert.deepEqual(audit.raw_source, { retained: 'original synthetic evidence' }); assert.equal(audit.correction_reason, 'Verified synthetic correction'); committedDay = id;
    });
    await t.test('repeat committed request/status returns same receipt without adding rows', async () => {
      const before = Number((await f.db.query('select count(*) n from retail_employee_daily_attendance')).rows[0].n);
      await f.commit(committedDay); assert.equal((await status(committedDay)).status, 'committed');
      assert.equal(Number((await f.db.query('select count(*) n from retail_employee_daily_attendance')).rows[0].n), before);
    });
    await t.test('nine-day 22,384 rows / 22,014 affected: atomic commit under 8s, complete typed snapshot', async () => {
      const rows = f.payload(22384, { days: 9, offset: 10000 }); await f.seed(rows.slice(0, 22014));
      const s = await snapshot(rows); assert.equal(s.count, 22014); assert.equal(s.records.length, 22014);
      const id = await f.batch(rows, s.records.map(r => r.id)), started = performance.now(); await f.commit(id); const ms = performance.now() - started;
      assert.ok(ms < 8000, `Nine-day correction ${ms.toFixed(1)}ms exceeds 8s`); t.diagnostic(`Nine-day: 22384 records / 22014 corrections in ${ms.toFixed(1)}ms; unchanged SQL statement timeout 8s`);
      assert.equal(await state(id), 'committed');
      assert.equal(Number((await f.db.query('select count(*) n from retail_employee_daily_attendance where batch_id=$1 and superseded_at is null', [id])).rows[0].n), 22384);
      assert.equal(Number((await f.db.query('select count(*) n from retail_employee_daily_attendance where superseded_by_batch=$1', [id])).rows[0].n), 22014);
    });
    await t.test('global writer contention fails promptly and read-only status distinguishes an active writer', async () => {
      const rows = f.payload(2, { date: '2026-11-12', offset: 60000 }), id = await f.batch(rows), other = await f.connect(true);
      await other.query('begin;select pg_advisory_xact_lock(hashtextextended(\'retail_uploaded_attendance\',0))');
      try {
        const started = performance.now(); await assert.rejects(() => f.commit(id), { code: '55P03' }); assert.ok(performance.now() - started < 1000);
        const s = await status(id); assert.equal(s.status, 'preview'); assert.equal(s.writer_busy, true);
      } finally { await other.query('rollback'); }
      assert.equal((await status(id)).writer_busy, false); await f.commit(id); assert.equal((await status(id)).status, 'committed');
    });
    await t.test('two independent correction previews cannot both supersede the same current employee/day', async () => {
      const rows = f.payload(2, { date: '2026-11-13', offset: 60000 }); await f.seed(rows);
      const s = await snapshot(rows), ids = s.records.map(r => r.id), a = await f.batch(rows, ids), b = await f.batch(rows, ids);
      const other = await f.connect(true), outcomes = await Promise.allSettled([f.commit(a), f.commit(b, other)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.ok(['55P03','40001'].includes(outcomes.find(r => r.status === 'rejected').reason.code));
      assert.equal(Number((await f.db.query("select count(*) n from retail_employee_daily_attendance where attendance_date='2026-11-13' and superseded_at is null")).rows[0].n), 2);
    });
    await t.test('failed insert rolls back every supersession; daily cap, duplicates, confirmation and invalid class remain enforced', async () => {
      const rows = f.payload(2, { date: '2026-11-14', offset: 60000 }); await f.seed(rows);
      const s = await snapshot(rows), ids = s.records.map(r => r.id), invalid = await f.batch([{ ...rows[0], source_row: 0 }, rows[1]], ids);
      await assert.rejects(() => f.commit(invalid), { code: '23514' }); assert.equal(await state(invalid), 'preview');
      assert.deepEqual((await snapshot(rows)).records.map(r => r.id), ids);
      const missingReason = await f.batch(rows, ids); await assert.rejects(() => f.commit(missingReason, f.client, true, ''), /reason required/);
      const duplicateRows=[rows[0], rows[0]], duplicate = await f.batch(duplicateRows, (await snapshot(duplicateRows)).records.map(r=>r.id)); await assert.rejects(() => f.commit(duplicate), /cannot exceed 1|duplicate key/);
      const alien = await f.batch([{ ...rows[0], class: 'OTHER' }], ids); await assert.rejects(() => f.commit(alien), { code: '42501' });
      const capRows=[{ ...rows[0], original_status: 'P', credit: 1 }, { ...rows[0], source_row: 3, retail_store_id: f.payload(3)[2].retail_store_id, store_code: f.payload(3)[2].store_code, original_status: 'HD', credit: 0.5 }];
      const overCredit = await f.batch(capRows, (await snapshot(capRows)).records.map(r=>r.id));
      await assert.rejects(() => f.commit(overCredit), /cannot exceed 1/); assert.deepEqual((await snapshot(rows)).records.map(r => r.id), ids);
    });
    await t.test('role, inactive, owner, state/class, cross-site employee/day and browser-role denials remain enforced', async () => {
      const rows = f.payload(2, { date: '2026-11-15', offset: 70000 }), id = await f.batch(rows);
      await f.db.query("update retail_mis_assignments set role='MIS_MEPC',states=array['AP-1'] where profile_id=$1", [actor]);
      await f.db.query("update profiles set role='MIS_MEPC' where id=$1", [actor]);
      await assert.rejects(() => f.commit(id), { code: '42501' }); await assert.rejects(() => status(id), { code: '42501' });
      const ap1=(await f.db.query("select * from reliance_retail_store_master where state='AP-1' limit 1")).rows[0],ap2=(await f.db.query("select * from reliance_retail_store_master where state='AP-2' limit 1")).rows[0];
      const apRow={...rows[0],employee_code:'AP-BOUNDARY',class:'MEPC',original_status:'HD',credit:0.5,retail_store_id:ap1.id,store_code:ap1.store_code};
      const crossRows=[apRow,{...apRow,source_row:3,retail_store_id:ap2.id,store_code:ap2.store_code}];await f.seed(crossRows);
      const cross=await f.batch([apRow],(await snapshot([apRow])).records.map(r=>r.id));
      await assert.rejects(()=>f.commit(cross),{code:'42501'});assert.equal((await snapshot([apRow])).count,2);
      const authorized=await f.batch([{...apRow,employee_code:'AP1-AUTHORIZED'}]);await f.commit(authorized);assert.equal((await status(authorized)).status,'committed');
      await f.db.query("update retail_mis_assignments set role='CENTRAL_MIS',states='{}' where profile_id=$1", [actor]);
      await f.db.query("update profiles set role='CENTRAL_MIS',is_active=false where id=$1", [actor]);
      await assert.rejects(() => f.commit(id), { code: '42501' }); await f.db.query('update profiles set is_active=true where id=$1', [actor]);
      await assert.rejects(() => status(committedDay, f.client, '00000000-0000-4000-8000-000000000002'), { code: '42501' });
      const browser = await f.connect(); await browser.query('set role authenticated');
      await assert.rejects(() => f.commit(id, browser), { code: '42501' }); await assert.rejects(() => status(id, browser), { code: '42501' });
      await assert.rejects(() => browser.query('select rpc_retail_attendance_conflict_snapshot($1)', [JSON.stringify(rows)]), { code: '42501' });
    });
    await t.test('client disconnect/timeout does not imply database rollback; later status safely confirms commit', async () => {
      const rows = f.payload(1, { date: '2026-11-16', offset: 90000 }), id = await f.batch(rows), other = await f.connect(true);
      // Synthetic local transport around the real RPC. Pause only in this test
      // so a client can disconnect before the database commits its transaction.
      let started,release,done,failed;
      const ready=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;}),finished=new Promise((r,j)=>{done=r;failed=j;});
      const server=createServer(async(_req,res)=>{try{await other.query('begin');await f.commit(id,other);started();await gate;await other.query('commit');res.end(id);done();}catch(e){failed(e);res.destroy();}});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));
      try{
        const c=new AbortController(),request=fetch(`http://127.0.0.1:${server.address().port}/commit`,{method:'POST',signal:c.signal}).then(()=>null,e=>e);
        await ready;c.abort();assert.equal((await request).name,'AbortError');
        assert.equal((await status(id)).status, 'preview'); assert.equal((await status(id)).writer_busy, true);
        release();await finished;assert.equal((await status(id)).status, 'committed');
        await f.commit(id); assert.equal((await snapshot(rows)).count, 1);
      }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
    });
  } finally { await f.close(); }
});
