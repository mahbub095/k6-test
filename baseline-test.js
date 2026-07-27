/**
 * বেসলাইন টেস্ট (Baseline Test)
 *
 * উদ্দেশ্য: স্বাভাবিক ও স্থিতিশীল লোডে সিস্টেমের স্বাভাবিক পারফরম্যান্স পরিমাপ করা।
 * ৫০ জন ভার্চুয়াল ব্যবহারকারী দিয়ে ৫ মিনিট ধরে চালানো হয়। এই টেস্টের ফলাফল
 * অন্যান্য টেস্টের তুলনামূলক মানদণ্ড (reference point) হিসেবে ব্যবহার করা হয়।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 50,
    duration: '5m',
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
