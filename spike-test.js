/**
 * স্পাইক টেস্ট (Spike Test)
 *
 * উদ্দেশ্য: হঠাৎ অনেক বেশি ব্যবহারকারী একসাথে আসলে সিস্টেম কেমন আচরণ করে তা যাচাই করা।
 * মাত্র ৩০ সেকেন্ডে ১০০ থেকে ৮,০০০ ব্যবহারকারীতে লোড লাফিয়ে ওঠে।
 * সিস্টেম এই আকস্মিক চাপ সামলাতে পারে কিনা এবং পরে স্বাভাবিক হয় কিনা
 * তা দেখা হয়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        spike: {
            executor: 'ramping-vus',
            stages: [
                { duration: '30s', target: 100 },
                { duration: '30s', target: 8000 },
                { duration: '1m', target: 8000 },
                { duration: '30s', target: 100 }
            ]
        }
    }
};

export default function () {
    const res = http.get('https://dss.bhata.gov.bd/online-application');

    check(res, {
        'Status 200': (r) => r.status === 200,
        'Response time < 500ms': (r) => r.timings.duration < 500,
        'Response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    sleep(1);
}
