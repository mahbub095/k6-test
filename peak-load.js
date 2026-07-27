/**
 * পিক লোড টেস্ট (Peak Load Test)
 *
 * উদ্দেশ্য: ব্যবহারকারীর সংখ্যা সর্বোচ্চ পর্যায়ে পৌঁছালে (যেমন অফিস খোলার সময়)
 * সিস্টেম কেমন পারফর্ম করে তা যাচাই করা।
 * ২,০০০ ভার্চুয়াল ব্যবহারকারী পর্যন্ত লোড নিয়ে ৫ মিনিট ধরে রাখা হয়,
 * তারপর ধীরে কমানো হয়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        peak: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 500 },
                { duration: '5m', target: 2000 },
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
