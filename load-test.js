/**
 * লোড টেস্ট (Load Test)
 *
 * উদ্দেশ্য: প্রত্যাশিত ও সর্বোচ্চ প্রত্যাশিত লোডে সিস্টেমের পারফরম্যান্স যাচাই করা।
 * ধীরে ধীরে ২০,০০০ ভার্চুয়াল ব্যবহারকারী পর্যন্ত লোড বাড়ানো হয়, তারপর কমানো হয়।
 * রেসপন্স টাইম, এরর রেট এবং থ্রুপুট পরিমাপ করা হয়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        load: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 200 },
                { duration: '5m', target: 20000 },
                { duration: '5m', target: 40000 },
                { duration: '5m', target: 50000 },
                { duration: '2m', target: 0 }
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
