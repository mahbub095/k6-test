/**
 * কনস্ট্যান্ট লোড টেস্ট (Constant Load Test)
 *
 * উদ্দেশ্য: দীর্ঘ সময় ধরে একই পরিমাণ লোডে সিস্টেমের স্থিতিশীলতা যাচাই করা।
 * ৫০০ জন ভার্চুয়াল ব্যবহারকারী দিয়ে টানা ৩০ মিনিট চালানো হয়।
 * এতে মেমরি লিক, রিসোর্স ক্ষয়, বা অন্যান্য দীর্ঘমেয়াদী সমস্যা ধরা পড়ে।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 500,
    duration: '30m'
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
