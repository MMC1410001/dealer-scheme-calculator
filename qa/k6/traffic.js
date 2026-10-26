// One "user" iteration: the dealer scheme status of one dealer from the pool, for all scheme tags.
import http from 'k6/http';
import { sleep } from 'k6';
import { DSS, TAGS, params, pickDealer, checkStatus } from './config.js';

// One request, no think time (used by rate.js, which sets the request rate itself).
// `data` is setup()'s return value: { token } from authSetup().
export function oneRequest(data) {
  const dealer = pickDealer();
  const res = http.post(DSS, JSON.stringify({ dealer_code: dealer, scheme_tags: TAGS }), params('dealer-scheme-status', data && data.token));
  checkStatus(res, dealer);
}

export function userIteration(data) {
  oneRequest(data);
  sleep(Math.random() * 0.5 + 0.25); // 0.25-0.75 s think time
}
