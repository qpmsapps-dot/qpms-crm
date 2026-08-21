import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildNimsSupervisorAvailability,
  listHospitalSupervisorAvailability,
  nimsSupervisorRosterDataIssues,
  supervisorAvailabilityStatus,
} from '../services/hospitalTicketService.js';

const nimsNow = new Date('2026-08-21T05:00:00.000Z'); // 10:30 AM IST

test('supervisor availability maps on-duty, duty-not-started and off-shift states', () => {
  const availability = buildNimsSupervisorAvailability([
    supervisorUser({ display_name: 'L. V. Sai', cug_number: '9948310098', duty_status: 'on_duty' }),
    supervisorUser({ display_name: 'Ch Ramu', cug_number: '9866320241', duty_status: 'off_duty' }),
    supervisorUser({ display_name: 'Y Nikhil', cug_number: '8886744183', duty_status: 'off_duty' }),
  ], nimsNow);

  assert.equal(availability.stale_tracking_supported, false);
  assert.equal(availability.counts.on_duty, 1);
  assert.equal(availability.counts.duty_not_started, 7);
  assert.equal(availability.counts.off_shift, 5);

  const byName = new Map(availability.supervisors.map((row) => [row.name, row]));
  assert.equal(byName.get('L. V. Sai').status, 'on_duty');
  assert.equal(byName.get('Ch Ramu').status, 'duty_not_started');
  assert.equal(byName.get('Y Nikhil').status, 'off_shift');
  assert.equal(byName.get('L. V. Sai').mobile_display, '9948310098');
});

test('duty-not-started and off-shift supervisors are not on-duty routing recipients', () => {
  const rosterRow = { start_minute: 8 * 60, end_minute: 16 * 60 };
  const activeShift = supervisorAvailabilityStatus({
    rosterRow,
    user: supervisorUser({ duty_status: 'off_duty' }),
    now: nimsNow,
  });
  const onDuty = supervisorAvailabilityStatus({
    rosterRow,
    user: supervisorUser({ duty_status: 'on_duty' }),
    now: nimsNow,
  });

  assert.equal(activeShift.status, 'duty_not_started');
  assert.equal(activeShift.is_on_duty, false);
  assert.equal(onDuty.status, 'on_duty');
  assert.equal(onDuty.is_on_duty, true);
});

test('availability endpoint exposes only operational roster fields to escalation owners', async () => {
  const rows = [
    supervisorUser({ id: 'user-lv-sai', display_name: 'L. V. Sai', cug_number: '9948310098', duty_status: 'on_duty' }),
  ];
  const availability = await listHospitalSupervisorAvailability(makeClient(rows), actor('operations_executive'), { now: nimsNow });

  assert.equal(availability.supervisors.length, 13);
  const lvSai = availability.supervisors.find((row) => row.name === 'L. V. Sai');
  assert.equal(lvSai.matched_user_id, 'user-lv-sai');
  assert.equal(lvSai.role_code, 'housekeeping_supervisor');
  assert.equal(lvSai.status, 'on_duty');
  assert.equal(Object.hasOwn(lvSai, 'email'), false);
});

test('facility manager and project head can access supervisor availability', async () => {
  await listHospitalSupervisorAvailability(makeClient([]), actor('facility_manager'), { now: nimsNow });
  await listHospitalSupervisorAvailability(makeClient([]), actor('project_head'), { now: nimsNow });
});

test('ordinary hospital roles cannot access management roster', async () => {
  await assert.rejects(
    () => listHospitalSupervisorAvailability(makeClient([]), actor('housekeeping_supervisor'), { now: nimsNow }),
    /Supervisor availability is available only to Hospital escalation owners/,
  );
});

test('NIMS roster flags the supplied V Anji Reddy phone number issue', () => {
  assert.deepEqual(nimsSupervisorRosterDataIssues(), [{
    roster_id: 'nims-supervisor-11',
    name: 'V Anji Reddy',
    issue: "Supplied mobile '970365667' is not 10 digits.",
  }]);
});

function supervisorUser(overrides = {}) {
  return {
    id: overrides.id || `user-${overrides.display_name || 'supervisor'}`,
    client_id: 'nims-client',
    profile_type: 'internal',
    role_code: 'housekeeping_supervisor',
    display_name: overrides.display_name || 'Supervisor',
    cug_number: overrides.cug_number || null,
    cug_number_display: overrides.cug_number_display || null,
    phone: overrides.phone || null,
    duty_status: overrides.duty_status || 'off_duty',
    duty_started_at: null,
    duty_ended_at: null,
    last_seen_at: null,
    metadata: {},
    is_active: true,
  };
}

function actor(roleCode) {
  return {
    user: {
      id: `actor-${roleCode}`,
      client_id: 'nims-client',
      profile_type: 'internal',
      role_code: roleCode,
    },
  };
}

function makeClient(rows) {
  return {
    from(table) {
      assert.equal(table, 'hospital_ticket_users');
      return queryResult(rows);
    },
  };
}

function queryResult(data) {
  const query = {
    select() { return query; },
    eq() { return query; },
    order() { return query; },
    then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
  return query;
}
