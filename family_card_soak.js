// ─── FAMILY CARD — SOAK TEST ──────────────────────────────────────────────────
// Purpose : Detect memory leaks, DB connection exhaustion, and slow degradation
//           under sustained moderate load over an extended period (~1 hour).
// Run     : k6 run family_card_soak.js

import { setup, familyCardDefault as default_ } from './lib/family_card_shared.js';
export { setup };
export default default_;

export const options = {
  stages: [
    { duration: '2m',  target: 100 },  // ramp up
    { duration: '2m',  target: 200 },  // reach soak load
    { duration: '56m', target: 200 },  // hold for 56 min (total ~1 hour)
    { duration: '5m',  target: 0   },  // ramp down
  ],
  thresholds: {
    // Strict — no degradation over time should be observed
    'http_req_duration':        ['p(95)<5000', 'p(99)<8000'],
    'http_req_failed':          ['rate<0.05'],
    'family_card_failure_rate': ['rate<0.05'],
    'save_draft_duration':      ['p(95)<5000'],
    'media_upload_duration':    ['p(95)<8000'],
    'finalize_duration':        ['p(95)<8000'],
  },
};
