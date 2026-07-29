/**
 * রিকভারি টেস্ট (Recovery Test)
 *
 * উদ্দেশ্য: উচ্চ লোডের পরে সিস্টেম স্বাভাবিক অবস্থায় ফিরে আসতে পারে কিনা তা যাচাই করা।
 * প্রথমে ৮,০০০ ভার্চুয়াল ব্যবহারকারী দিয়ে চাপ দেওয়া হয়, তারপর হঠাৎ ১০০-তে নামিয়ে
 * দেখা হয় সিস্টেম রেসপন্স টাইম ও স্থিতিশীলতা পুনরুদ্ধার করতে পারে কিনা।
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
        recovery: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 8000 },
                { duration: '5m', target: 8000 },
                { duration: '3m', target: 100 },
                { duration: '5m', target: 100 },
            ],
        },
    },

    // থ্রেশহোল্ড — এই সীমা পার হলে টেস্ট FAIL হবে
    thresholds: {
        'get_response_time':   ['p(95)<5000'],
        'post_response_time':  ['p(95)<6000'],
        'batch_response_time': ['p(95)<5500'],
        'error_rate':          ['rate<0.10'],
        'http_req_duration':   ['p(90)<5000', 'p(95)<6000'],
    },
};

export default function () {

    // ১. GET রিকোয়েস্ট গ্রুপ
    group('GET - Online Application Page', () => {
        const res = http.get('https://dss.bhata.gov.bd/online-application', {
            tags: { type: 'get', test: 'recovery', page: 'online-application' },
        });

        getResponseTime.add(res.timings.duration);
        requestCount.add(1);

        const ok = check(res, {
            'GET Status 200':          (r) => r.status === 200,
            'GET Response time < 5s':  (r) => r.timings.duration < 5000,
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
    //         tags:    { type: 'post', test: 'recovery', page: 'online-application' },
    //     };

    //     const res = http.post('https://dss.bhata.gov.bd/online-application', payload, params);

    //     postResponseTime.add(res.timings.duration);
    //     requestCount.add(1);

    //     const ok = check(res, {
    //         'POST Status 200 or 201':     (r) => r.status === 200 || r.status === 201,
    //         'POST Response time < 6s':    (r) => r.timings.duration < 6000,
    //         'POST No server error (5xx)': (r) => r.status < 500,
    //     });
    //     errorRate.add(!ok);
    // });

    // ৩. http.batch() — একসাথে একাধিক রিকোয়েস্ট
    group('BATCH - Parallel Requests', () => {
        const responses = http.batch([
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'recovery', request: 'batch-1' } }],
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'recovery', request: 'batch-2' } }],
        ]);

        responses.forEach((res, i) => {
            batchResponseTime.add(res.timings.duration);
            requestCount.add(1);

            const ok = check(res, {
                [`Batch [${i}] Status 200`]:         (r) => r.status === 200,
                [`Batch [${i}] Response time < 5s`]: (r) => r.timings.duration < 5000,
            });
            errorRate.add(!ok);
        });
    });

    sleep(1);
}
