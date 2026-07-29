/**
 * Smoke Test
 *
 * Purpose: Verify the system works at the most basic level with minimal load.
 *          Only 10 VUs for 1 minute — confirms the server is up and returning
 *          HTTP 200 responses before any heavier test is run.
 *
 * How to run:
 *   k6 run smoke-test.js
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
    vus:      10,
    duration: '1m',

    thresholds: {
        'get_response_time':   [{ threshold: 'p(95)<2000', abortOnFail: false }],
        'batch_response_time': [{ threshold: 'p(95)<2500', abortOnFail: false }],
        'error_rate':          [{ threshold: 'rate<0.05',  abortOnFail: false }],
        'http_req_duration':   [
            { threshold: 'p(90)<2000', abortOnFail: false },
            { threshold: 'p(95)<3000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // Step 1: Load login page and retrieve CSRF token
    const pageRes = http.get(`${BASE_URL}admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page', test: 'smoke' },
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
            tags: { type: 'get', test: 'smoke', page: 'online-application' },
        });
        requestCount.add(1);

        // Skip metric recording if connection failed
        if (!res || res.status === 0 || !res.body) {
            errorRate.add(1);
            return;
        }

        getResponseTime.add(res.timings.duration);

        const ok = check(res, {
            'GET Status 200':         (r) => r.status === 200,
            'GET Response time < 2s': (r) => r.timings.duration < 2000,
            'GET No server error':    (r) => r.status < 500,
            'GET Body not empty':     (r) => r.body && r.body.length > 0,
        });
        errorRate.add(!ok);
    });
    sleep(1);
}
