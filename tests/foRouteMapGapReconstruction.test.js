import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/pages/FOActivities.jsx', 'utf8');

test('route map reconstructs only boundaries between segmented GPS paths', () => {
  const helper = source.slice(
    source.indexOf('function routeGapBoundariesFromSegments'),
    source.indexOf('\nfunction directionsRouteForGap', source.indexOf('function routeGapBoundariesFromSegments')),
  );
  assert.match(helper, /segment\?\.\[segment\.length - 1\]/);
  assert.match(helper, /segments\[index \+ 1\]\?\.\[0\]/);
  assert.match(helper, /hasFiniteCoordinates\(start\)/);
  assert.match(helper, /hasFiniteCoordinates\(end\)/);
});

test('estimated gaps use DirectionsService and stay transient', () => {
  const mapSection = source.slice(
    source.indexOf('function GoogleRouteMap'),
    source.indexOf('\nfunction RouteLegendLine', source.indexOf('function GoogleRouteMap')),
  );
  assert.match(mapSection, /new maps\.DirectionsService\(\)/);
  assert.match(mapSection, /source: "google_directions"/);
  assert.match(mapSection, /source: "route_unavailable"/);
  assert.match(mapSection, /path: \[gap\.start, gap\.end\]/);
  assert.match(mapSection, /reconstructedRouteGapCache/);
  assert.doesNotMatch(mapSection, /supabase\.from\(/);
  assert.doesNotMatch(mapSection, /fo_travel_legs/);
});

test('route map legend and estimated-route tooltip distinguish reconstructed paths', () => {
  const mapSection = source.slice(
    source.indexOf('function GoogleRouteMap'),
    source.indexOf('\nfunction RouteLegendLine', source.indexOf('function GoogleRouteMap')),
  );
  assert.match(mapSection, /Actual GPS/);
  assert.match(mapSection, /Estimated Route/);
  assert.match(mapSection, /Route Unavailable/);
  assert.match(mapSection, /Source: Google Directions/);
  assert.match(mapSection, /GPS data was unavailable/);
  assert.match(mapSection, /strokeColor: unavailable \? "#64748b" : "#f97316"/);
  assert.match(source, /borderStyle: dotted \? "dotted" : dashed \? "dashed" : "solid"/);
});
