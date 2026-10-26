// Smoke: 1 VU for 30 s. Run it before any heavier test; it must pass cleanly.
//   k6 run smoke.js
import http from 'k6/http';
import { check } from 'k6';
import { HEALTH, thresholds, summaryTrendStats, summaryTo, authSetup } from './config.js';
import { userIteration } from './traffic.js';

export const options = {
  vus: 1,
  duration: __ENV.DURATION || '30s',
  thresholds,
  summaryTrendStats,
};

export function setup() {
  const res = http.get(HEALTH);
  if (!check(res, { 'health is 200': (r) => r.status === 200 })) {
    throw new Error(`API not healthy at ${HEALTH} (status ${res.status})`);
  }
  return authSetup(); // one token for the whole run
}

export default userIteration;
export const handleSummary = summaryTo('smoke');
