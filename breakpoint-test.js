/**
 * Breakpoint Test
 *
 * Purpose: Find the maximum capacity of the system — the point at which it
 *          breaks under load. VUs are increased in steps up to 25,000.
 *          Each stage holds for 2 minutes to observe performance degradation.
 *
 * How to run:
 *   k6 run breakpoint-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://asianserver.xyz/';

// ── Custom Metrics ────────────────────────────────────────────────────────────
const getResponseTime   = new Trend('get_response_time', true);
const batchResponseTime = new Trend('batch_response_time', true);
const requestCount      = new Counter('total_requests');
const errorRate         = new Rate('error_rate');

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        breakpoint: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 5000  },
                { duration: '2m', target: 10000 },
                { duration: '2m', target: 15000 },
                { duration: '2m', target: 20000 },
                { duration: '2m', target: 25000 },
                { duration: '2m', target: 0     },
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
    const pageRes = http.get(`${BASE_URL}/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page', test: 'breakpoint' },
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

    // Step 2: GET — load the online application page
    group('GET - Online Application Page', () => {
        const res = http.get(`${BASE_URL}online-application`, {
            timeout: '30s',
            tags: { type: 'get', test: 'breakpoint', page: 'online-application' },
        });
        requestCount.add(1);

        if (!res || res.status === 0 || !res.body) {
            errorRate.add(1);
            return;
        }

        getResponseTime.add(res.timings.duration);

        const ok = check(res, {
            'GET Status 200':         (r) => r.status === 200,
            'GET Response time < 5s': (r) => r.timings.duration < 5000,
            'GET No server error':    (r) => r.status < 500,
            'GET Body not empty':     (r) => r.body && r.body.length > 0,
        });
        errorRate.add(!ok);
    });
    sleep(1);
}
