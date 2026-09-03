// ─── FAMILY CARD — LOAD TEST ──────────────────────────────────────────────────
// Purpose : Verify the system handles expected peak load (500 VUs).
// Run     : k6 run family_card_load.js

import { setup, familyCardDefault as default_ } from './lib/family_card_shared.js';
export { setup };
export default default_;

export const options = {
  stages: [
    { duration: '1m',  target: 1 },  // ramp up to 100 VUs
    // { duration: '3m',  target: 300 },  // ramp up to 300 VUs
    // { duration: '3m',  target: 500 },  // ramp up to 500 VUs
    // { duration: '5m',  target: 500 },  // hold at peak
    { duration: '2m',  target: 0   },  // ramp down
  ],
  thresholds: {
    'http_req_duration':        ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed':          ['rate<0.05'],
    'family_card_failure_rate': ['rate<0.05'],
    'save_draft_duration':      ['p(95)<3000'],
    'media_upload_duration':    ['p(95)<5000'],
    'finalize_duration':        ['p(95)<5000'],
  },
};
