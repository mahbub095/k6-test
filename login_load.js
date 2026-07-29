/**
 * লোড টেস্ট — Login Phase
 *
 * উদ্দেশ্য: ধীরে ধীরে ২০,০০০ VU পর্যন্ত লোড বাড়িয়ে লগইন এন্ডপয়েন্টের
 *           রেসপন্স টাইম, এরর রেট ও থ্রুপুট পরিমাপ করা।
 *
 * চালানোর নিয়ম:
 *   k6 run k6/scenarios/login_load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── কনফিগ ─────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://stage-api.bhata.gov.bd/api/v1/';
const EMAIL    = 'admin';
const PASSWORD = 'admin';

// ── কাস্টম মেট্রিক্স ─────────────────────────────────────────────────────────
const loginDuration = new Trend('login_duration', true);
const requestCount  = new Counter('total_requests');
const errorRate     = new Rate('error_rate');

// ── টেস্ট কনফিগারেশন ─────────────────────────────────────────────────────────
export const options = {
    scenarios: {
        load: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 200   },  // ধীরে রেম্প-আপ
                { duration: '5m', target: 20000 },  // পিক লোড
                { duration: '2m', target: 0     },  // রেম্প-ডাউন
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        'login_duration':    [{ threshold: 'p(95)<5000',  abortOnFail: false }],
        'error_rate':        [{ threshold: 'rate<0.05',   abortOnFail: false }],
        'http_req_duration': [
            { threshold: 'p(90)<4000', abortOnFail: false },
            { threshold: 'p(95)<5000', abortOnFail: false },
        ],
    },
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function () {

    // ধাপ ১: লগইন পেজ থেকে CSRF টোকেন নেওয়া
    const pageRes = http.get(`${BASE_URL}/admin/login`, {
        timeout: '30s',
        tags: { step: 'get-login-page' },
    });
    requestCount.add(1);

    // সংযোগ ব্যর্থ হলে অথবা বডি না থাকলে এই ইটারেশন বাদ দাও
    if (!pageRes || pageRes.status === 0 || !pageRes.body) {
        console.warn(`[GET] Connection failed or empty body — status: ${pageRes ? pageRes.status : 'null'}`);
        errorRate.add(1);
        sleep(1);
        return;
    }

    // পেজ লোড চেক
    const pageOk = check(pageRes, {
        'Login page → 200':      (r) => r.status === 200,
        'Login page has content': (r) => r.body && r.body.length > 0,
    });
    if (!pageOk) {
        errorRate.add(1);
        sleep(1);
        return;
    }

    // HTML থেকে CSRF টোকেন বের করা
    const csrfToken = pageRes.html().find('input[name="_token"]').attr('value');
    if (!csrfToken) {
        console.warn('[CSRF] Token not found in login page — skipping iteration');
        errorRate.add(1);
        sleep(1);
        return;
    }

    sleep(1);

    // ধাপ ২: email ও password দিয়ে লগইন
    const loginRes = http.post(
        `${BASE_URL}/admin/login`,
        { _token: csrfToken, email: EMAIL, password: PASSWORD },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'text/html',
            },
            redirects: 5,
            timeout: '30s',
            tags: { step: 'post-login' },
        }
    );
    requestCount.add(1);

    // লগইন রেসপন্স নাল হলে বাদ দাও
    if (!loginRes || loginRes.status === 0) {
        console.warn(`[POST] Login request failed — status: ${loginRes ? loginRes.status : 'null'}`);
        errorRate.add(1);
        sleep(1);
        return;
    }

    loginDuration.add(loginRes.timings.duration);

    const ok = check(loginRes, {
        'Login → 200':         (r) => r.status === 200,
        'Login response < 5s': (r) => r.timings.duration < 5000,
        'No server error':     (r) => r.status < 500,
    });
    errorRate.add(!ok);

    sleep(1);
}
