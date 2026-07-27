/**
 * রিকভারি টেস্ট (Recovery Test)
 *
 * উদ্দেশ্য: উচ্চ লোডের পরে সিস্টেম স্বাভাবিক অবস্থায় ফিরে আসতে পারে কিনা তা যাচাই করা।
 * প্রথমে ৮,০০০ ভার্চুয়াল ব্যবহারকারী দিয়ে চাপ দেওয়া হয়, তারপর হঠাৎ ১০০-তে নামিয়ে
 * দেখা হয় সিস্টেম রেসপন্স টাইম ও স্থিতিশীলতা পুনরুদ্ধার করতে পারে কিনা।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        recovery: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 8000 },
                { duration: '5m', target: 8000 },
                { duration: '3m', target: 100 },
                { duration: '5m', target: 100 }
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
