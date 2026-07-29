/**
 * Spike Test
 *
 * Purpose: Verify how the system handles a sudden, extreme surge of users.
 *          Load jumps from 100 to 8,000 VUs in just 30 seconds. Checks whether
 *          the system survives the shock and recovers afterward.
 *
 * How to run:
 *   k6 run spike-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://stage-api.bhata.gov.bd/api/v1/';

// ── Custom Metrics ────────────────────────────────────────────────────────────
const getResponseTime   = new Trend('get_response_time', true);
const batchResponseTime = new Trend('batch_response_time', true);
const requestCount      = new Counter('total_requests');
const errorRate         = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        spike: {
            executor: 'ramping-vus',
            stages: [
                { duration: '30s', target: 100  },  // baseline
                { duration: '30s', target: 8000 },  // sudden spike
                { duration: '1m',  target: 8000 },  // hold at spike
                { duration: '30s', target: 100  },  // recover
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        'get_response_time':   [{ threshold: 'p(95)<5000', abortOnFail: false }],
        'batch_response_time': [{ threshold: 'p(95)<5500', abortOnFail: false }],
        'error_rate':          [{ threshold: 'rate<0.10',  abortOnFail: false }],
        'http_req_duration':   [
            { threshold: 'p(90)<5000', abortOnFail: false },
            { threshold: 'p(95)<6000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Step 1: Load login page and retrieve CSRF token
    const pageRes = http.get(`${BASE_URL}admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page', test: 'spike' },
    });
    requestCount.add(1);

    if (!pageRes || pageRes.status === 0 || !pageRes.body) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    const pageOk = check(pageRes, {
        'Login page → 200':       (r) => r.status === 200,
        'Login page has content': (r) => r.body && r.body.length > 0,
    });
    if (!pageOk) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    const csrfToken = pageRes.html().find('input[name="_token"]').attr('value');

    if (!csrfToken) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    sleep(1);
}
