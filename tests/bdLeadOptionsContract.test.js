import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const crmPath = new URL('../src/pages/CRM.jsx', import.meta.url);

test('web lead form uses the approved industry dropdown and service checkboxes', async () => {
  const source = await readFile(crmPath, 'utf8');
  const industryList = "['Manufacturing', 'Educational', 'Retail', 'Commercial', 'Electronics', 'Hospital']";
  const serviceList = "['Soft Services', 'Hard Services', 'Security Services', 'Pest Control Services', 'Landscaping Services', 'Waste Management', 'Other Services']";

  assert.match(source, new RegExp(industryList.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, new RegExp(serviceList.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /placeholder="Select Industry"/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /checked=\{active\}/);
  assert.match(source, /cancelLeadChanges/);
  assert.doesNotMatch(source, /const industryOptions = \['Healthcare'/);
  assert.doesNotMatch(source, /const serviceScopeOptions = \['Hard Services MEP'/);
});
