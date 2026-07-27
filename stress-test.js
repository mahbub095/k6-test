/**
 * স্ট্রেস টেস্ট (Stress Test)
 *
 * উদ্দেশ্য: সিস্টেমকে স্বাভাবিক সীমার বাইরে ঠেলে দিয়ে দেখা কখন এবং কীভাবে ব্যর্থ হয়।
 * ধীরে ধীরে ৮,০০০ ভার্চুয়াল ব্যবহারকারী পর্যন্ত লোড বাড়ানো হয়।
 * সিস্টেমের ব্যর্থতার ধরন, এরর মেসেজ এবং চাপ কমলে পুনরুদ্ধারের
 * ক্ষমতা পরিমাপ করা হয়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        stress: {
            executor: 'ramping-vus',
            stages: [
                { duration: '1m', target: 500 },
                { duration: '2m', target: 2000 },
                { duration: '3m', target: 5000 },
                { duration: '5m', target: 8000 },
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
