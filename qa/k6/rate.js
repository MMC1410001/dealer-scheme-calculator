// Rate: a fixed number of requests per second, whatever the response time (up to 1 lakh requests a minute
// = about 1,700 a second, the peak of the reference API). Compare the server with CACHE_ENABLED=false and true
// (answers carry X-Cache: HIT / MISS when the cache is on; the summary shows the hit share).
//   k6 run rate.js                        # 1,700 requests/s for 2 minutes
//   RATE=600 DURATION=5m k6 run rate.js
// The server needs API_RATE_LIMIT_PER_MINUTE above RATE x 60 (one client_id sends every request). The default
// limit is 1,00,000 a minute (about 1,666 a second). So the default RATE of 1,700 (1,02,000 a minute) gets 429 at
// the end of each minute: for this run, start the server with a higher limit (e.g. API_RATE_LIMIT_PER_MINUTE=200000)
// or use RATE=1650 to test at the real per-client limit.
import { thresholds, summaryTrendStats, summaryTo, authSetup } from './config.js';
import { oneRequest } from './traffic.js';

const RATE = parseInt(__ENV.RATE || '1700');
const DURATION = __ENV.DURATION || '2m';
const SECONDS = parseInt(DURATION) * (DURATION.endsWith('m') ? 60 : 1);

export const options = {
  scenarios: {
    rate: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.min(RATE, 400),
      maxVUs: parseInt(__ENV.MAX_VUS || '2000'),
    },
  },
  thresholds: { ...thresholds, dropped_iterations: ['count<' + Math.ceil(RATE * 0.01 * SECONDS)] }, // < 1% not sent
  summaryTrendStats,
};

export default oneRequest;
export const setup = authSetup; // one token for the whole run
export const handleSummary = summaryTo('rate');
