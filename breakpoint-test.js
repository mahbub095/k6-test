/**
 * ব্রেকপয়েন্ট টেস্ট (Breakpoint Test)
 *
 * উদ্দেশ্য: সিস্টেমের সর্বোচ্চ ধারণক্ষমতা খুঁজে বের করা — কত লোড পর্যন্ত সিস্টেম ভেঙে পড়ে না।
 * লোড ধীরে ধীরে বাড়িয়ে ২৫,০০০ ভার্চুয়াল ব্যবহারকারী পর্যন্ত নিয়ে যাওয়া হয়।
 * প্রতিটি স্তরে ২ মিনিট ধরে রেখে দেখা হয় কোন পর্যায়ে সিস্টেমের পারফরম্যান্স কমে যায়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        breakpoint: {
            executor: 'ramping-vus',
            stages: [
                { duration: '2m', target: 5000 },
                { duration: '2m', target: 10000 },
                { duration: '2m', target: 15000 },
                { duration: '2m', target: 20000 },
                { duration: '2m', target: 25000 },
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
