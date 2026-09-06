// ─── FAMILY CARD — STRESS TEST ────────────────────────────────────────────────
// Purpose : Find the breaking point by pushing load incrementally beyond
//           normal capacity until the system degrades or fails.
// Pattern : 6 incremental steps from 100 → 1000 VUs.
// Total   : 20 minutes
// Run     : k6 run family_card_stress.js

import { setup, familyCardDefault as default_, makeHandleSummary } from './lib/family_card_shared.js';
export { setup };
export default default_;
export const handleSummary = makeHandleSummary('stress');

export const options = {
  stages: [
    { duration: '2m', target: 100  },  // warm up
    { duration: '2m', target: 200  },  // step 1
    { duration: '2m', target: 400  },  // step 2
    { duration: '2m', target: 600  },  // step 3 — beyond normal
    { duration: '2m', target: 800  },  // step 4 — stress zone
    { duration: '3m', target: 1000 },  // step 5 — breaking point search
    { duration: '3m', target: 0    },  // ramp down
    { duration: '4m', target: 0    },  // cooldown / observation
  ],                                   // total: 20m
  thresholds: {
    // Moderate — expect degradation but track the breaking point
    'http_req_duration':        ['p(95)<8000', 'p(99)<15000'],
    'http_req_failed':          ['rate<0.20'],
    'family_card_failure_rate': ['rate<0.20'],
    'save_draft_duration':      ['p(95)<8000'],
    'media_upload_duration':    ['p(95)<12000'],
    'finalize_duration':        ['p(95)<12000'],
  },
};
