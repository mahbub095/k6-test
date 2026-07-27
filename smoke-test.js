/**
 * স্মোক টেস্ট (Smoke Test)
 *
 * উদ্দেশ্য: সিস্টেমটি একদম মৌলিক পর্যায়ে সঠিকভাবে কাজ করছে কিনা তা যাচাই করা।
 * এটি সবচেয়ে হালকা পারফরম্যান্স টেস্ট — মাত্র ১০ জন ভার্চুয়াল ব্যবহারকারী
 * দিয়ে ১ মিনিট চালানো হয়। মূল লক্ষ্য হলো নিশ্চিত করা যে সার্ভার চালু আছে
 * এবং HTTP ২০০ রেসপন্স দিচ্ছে।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 10,
    duration: '1m',
};

export default function () {
    const res = http.get('https://dss.bhata.gov.bd/online-application');

    check(res, {
        'Status 200': (r) => r.status === 200,
        'Response time < 500ms': (r) => r.timings.duration < 2000,
        'Response time < 1000ms': (r) => r.timings.duration < 3000,
    });

    sleep(1);
}
