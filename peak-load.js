/**
 * Peak Load Test
 *
 * Purpose: Verify system performance when user traffic reaches its highest
 *          expected point (e.g. office opening hours). Load ramps to 2,000 VUs,
 *          holds for 5 minutes, then ramps back down.
 *
 * How to run:
 *   k6 run peak-load.js
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
        peak: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 500  },  // slow ramp-up
                { duration: '5m', target: 2000 },  // peak load
                { duration: '2m', target: 0    },  // ramp-down
            ],
            gracefulRampDown: '30s',
        },
    },

    // ── Grafana Cloud Configuration ───────────────────────────────────────────
    // Run with: k6 cloud run peak-load.js
    cloud: {
        name:        'Peak Load Test',
        projectID:   8273634,    // ✅ Your Project ID
        
        // Free tier only allows 1 load zone
        // Remove distribution block for Free tier
    },

    thresholds: {
        'get_response_time':   [{ threshold: 'p(95)<3000', abortOnFail: false }],
        'batch_response_time': [{ threshold: 'p(95)<3500', abortOnFail: false }],
        'error_rate':          [{ threshold: 'rate<0.05',  abortOnFail: false }],
        'http_req_duration':   [
            { threshold: 'p(90)<3000', abortOnFail: false },
            { threshold: 'p(95)<4000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Step 1: Load login page and retrieve CSRF token
    const pageRes = http.get(`${BASE_URL}admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page', test: 'peak-load' },
    });
    requestCount.add(1);

    // Skip this iteration if the connection failed or body is null
    if (!pageRes || pageRes.status === 0 || !pageRes.body) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    // Check login page loaded successfully
    const pageOk = check(pageRes, {
        'Login page → 200':       (r) => r.status === 200,
        'Login page has content': (r) => r.body && r.body.length > 0,
    });
    if (!pageOk) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    // Extract CSRF token from HTML
    const csrfToken = pageRes.html().find('input[name="_token"]').attr('value');

    // Skip if CSRF token is missing — POST would fail with 419 anyway
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
            tags: { type: 'get', test: 'peak-load', page: 'online-application' },
        });
        requestCount.add(1);

        if (!res || res.status === 0 || !res.body) {
            errorRate.add(1);
            return;
        }

        getResponseTime.add(res.timings.duration);

        const ok = check(res, {
            'GET Status 200':         (r) => r.status === 200,
            'GET Response time < 3s': (r) => r.timings.duration < 3000,
            'GET No server error':    (r) => r.status < 500,
            'GET Body not empty':     (r) => r.body && r.body.length > 0,
        });
        errorRate.add(!ok);
    });
    sleep(1);
}
