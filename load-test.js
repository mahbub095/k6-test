/**
 * লোড টেস্ট (Load Test)
 *
 * উদ্দেশ্য: প্রত্যাশিত ও সর্বোচ্চ প্রত্যাশিত লোডে সিস্টেমের পারফরম্যান্স যাচাই করা।
 * ধীরে ধীরে ২০,০০০ ভার্চুয়াল ব্যবহারকারী পর্যন্ত লোড বাড়ানো হয়, তারপর কমানো হয়।
 * রেসপন্স টাইম, এরর রেট এবং থ্রুপুট পরিমাপ করা হয়।
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// কাস্টম মেট্রিক্স
const getResponseTime   = new Trend('get_response_time', true);
const postResponseTime  = new Trend('post_response_time', true);
const batchResponseTime = new Trend('batch_response_time', true);
const requestCount      = new Counter('total_requests');
const errorRate         = new Rate('error_rate');

export const options = {
    scenarios: {
        load: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 200 },
                { duration: '5m', target: 20000 },
                { duration: '2m', target: 0 },
            ],
        },
    },

    // থ্রেশহোল্ড — এই সীমা পার হলে টেস্ট FAIL হবে
    thresholds: {
        'get_response_time':   ['p(95)<4000'],
        'post_response_time':  ['p(95)<5000'],
        'batch_response_time': ['p(95)<4500'],
        'error_rate':          ['rate<0.05'],
        'http_req_duration':   ['p(90)<4000', 'p(95)<5000'],
    },
};

export default function () {

    // ১. GET রিকোয়েস্ট গ্রুপ
    group('GET - Online Application Page', () => {
        const res = http.get('https://dss.bhata.gov.bd/online-application', {
            tags: { type: 'get', test: 'load', page: 'online-application' },
        });

        getResponseTime.add(res.timings.duration);
        requestCount.add(1);

        const ok = check(res, {
            'GET Status 200':          (r) => r.status === 200,
            'GET Response time < 4s':  (r) => r.timings.duration < 4000,
            'GET No server error':     (r) => r.status < 500,
            'GET Body not empty':      (r) => r.body && r.body.length > 0,
        });
        errorRate.add(!ok);
    });

    // ২. POST রিকোয়েস্ট গ্রুপ
    // group('POST - Submit Application Form', () => {
    //     const payload = JSON.stringify({
    //         name:    'Test User',
    //         nid:     '1234567890',
    //         phone:   '01700000000',
    //         address: 'Dhaka, Bangladesh',
    //     });

    //     const params = {
    //         headers: { 'Content-Type': 'application/json' },
    //         tags:    { type: 'post', test: 'load', page: 'online-application' },
    //     };

    //     const res = http.post('https://dss.bhata.gov.bd/online-application', payload, params);

    //     postResponseTime.add(res.timings.duration);
    //     requestCount.add(1);

    //     const ok = check(res, {
    //         'POST Status 200 or 201':     (r) => r.status === 200 || r.status === 201,
    //         'POST Response time < 5s':    (r) => r.timings.duration < 5000,
    //         'POST No server error (5xx)': (r) => r.status < 500,
    //     });
    //     errorRate.add(!ok);
    // });

    // ৩. http.batch() — একসাথে একাধিক রিকোয়েস্ট
    group('BATCH - Parallel Requests', () => {
        const responses = http.batch([
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'load', request: 'batch-1' } }],
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'load', request: 'batch-2' } }],
        ]);

        responses.forEach((res, i) => {
            batchResponseTime.add(res.timings.duration);
            requestCount.add(1);

            const ok = check(res, {
                [`Batch [${i}] Status 200`]:         (r) => r.status === 200,
                [`Batch [${i}] Response time < 4s`]: (r) => r.timings.duration < 4000,
            });
            errorRate.add(!ok);
        });
    });

    sleep(1);
}

