/**
 * স্মোক টেস্ট (Smoke Test)
 *
 * উদ্দেশ্য: সিস্টেমটি একদম মৌলিক পর্যায়ে সঠিকভাবে কাজ করছে কিনা তা যাচাই করা।
 * এটি সবচেয়ে হালকা পারফরম্যান্স টেস্ট — মাত্র ১০ জন ভার্চুয়াল ব্যবহারকারী
 * দিয়ে ১ মিনিট চালানো হয়। মূল লক্ষ্য হলো নিশ্চিত করা যে সার্ভার চালু আছে
 * এবং HTTP ২০০ রেসপন্স দিচ্ছে।
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// কাস্টম মেট্রিক্স
const getResponseTime  = new Trend('get_response_time', true);
const postResponseTime = new Trend('post_response_time', true);
const batchResponseTime = new Trend('batch_response_time', true);
const requestCount     = new Counter('total_requests');
const errorRate        = new Rate('error_rate');

export const options = {
    vus: 10,
    duration: '1m',

    // থ্রেশহোল্ড — এই সীমা পার হলে টেস্ট FAIL হবে
    thresholds: {
        'get_response_time':   ['p(95)<2000'],
        'post_response_time':  ['p(95)<3000'],
        'batch_response_time': ['p(95)<2500'],
        'error_rate':          ['rate<0.05'],
        'http_req_duration':   ['p(90)<2000', 'p(95)<3000'],
    },
};

export default function () {

    // ১. GET রিকোয়েস্ট গ্রুপ
    group('GET - Online Application Page', () => {
        const res = http.get('https://dss.bhata.gov.bd/online-application', {
            tags: { type: 'get', test: 'smoke', page: 'online-application' },
        });

        getResponseTime.add(res.timings.duration);
        requestCount.add(1);

        const ok = check(res, {
            'GET Status 200':          (r) => r.status === 200,
            'GET Response time < 2s':  (r) => r.timings.duration < 2000,
            'GET Response time < 3s':  (r) => r.timings.duration < 3000,
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
    //         tags:    { type: 'post', test: 'smoke', page: 'online-application' },
    //     };

    //     const res = http.post('https://dss.bhata.gov.bd/online-application', payload, params);

    //     postResponseTime.add(res.timings.duration);
    //     requestCount.add(1);

    //     const ok = check(res, {
    //         'POST Status 200 or 201':     (r) => r.status === 200 || r.status === 201,
    //         'POST Response time < 3s':    (r) => r.timings.duration < 3000,
    //         'POST No server error (5xx)': (r) => r.status < 500,
    //     });
    //     errorRate.add(!ok);
    // });

    // ৩. http.batch() — একসাথে একাধিক রিকোয়েস্ট
    group('BATCH - Parallel Requests', () => {
        const responses = http.batch([
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'smoke', request: 'batch-1' } }],
            ['GET', 'https://dss.bhata.gov.bd/online-application', null,
                { tags: { type: 'batch', test: 'smoke', request: 'batch-2' } }],
        ]);

        responses.forEach((res, i) => {
            batchResponseTime.add(res.timings.duration);
            requestCount.add(1);

            const ok = check(res, {
                [`Batch [${i}] Status 200`]:         (r) => r.status === 200,
                [`Batch [${i}] Response time < 2s`]: (r) => r.timings.duration < 2000,
            });
            errorRate.add(!ok);
        });
    });

    sleep(1);
}
