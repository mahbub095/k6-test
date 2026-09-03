// ─── FAMILY CARD — SPIKE TEST ─────────────────────────────────────────────────
// Purpose : Verify the system survives a sudden massive traffic surge and
//           recovers once the spike drops.
// Pattern : Low baseline → instant 10× surge → hold → drop → recovery check.
// Total   : 20 minutes
// Run     : k6 run family_card_spike.js

import { setup, familyCardDefault as default_, makeHandleSummary } from './lib/family_card_shared.js';
export { setup };
export default default_;
export const handleSummary = makeHandleSummary('spike');

export const options = {
  stages: [
    { duration: '2m',  target: 50  },  // baseline
    { duration: '30s', target: 500 },  // spike — sudden 10× surge
    { duration: '8m',  target: 500 },  // hold spike
    { duration: '30s', target: 50  },  // drop back to baseline
    { duration: '6m',  target: 50  },  // recovery hold
    { duration: '3m',  target: 0   },  // ramp down
  ],                                   // total: 20m
  thresholds: {
    // Relaxed — some degradation during spike is acceptable
    'http_req_duration':        ['p(95)<10000', 'p(99)<20000'],
    'http_req_failed':          ['rate<0.30'],
    'family_card_failure_rate': ['rate<0.30'],
    'save_draft_duration':      ['p(95)<10000'],
    'media_upload_duration':    ['p(95)<15000'],
    'finalize_duration':        ['p(95)<15000'],
  },
};
