/**
 * সোক টেস্ট (Soak Test / Endurance Test)
 *
 * উদ্দেশ্য: দীর্ঘ সময়ের জন্য নিয়মিত লোডে সিস্টেমের স্থায়িত্ব ও সহনশীলতা যাচাই করা।
 * ১,০০০ ভার্চুয়াল ব্যবহারকারী দিয়ে টানা ২ ঘণ্টা চালানো হয়।
 * মেমরি লিক, ডাটাবেস সংযোগ সমস্যা, বা অন্যান্য দীর্ঘমেয়াদী সমস্যা
 * খুঁজে বের করা এই টেস্টের মূল লক্ষ্য।
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 1000,
    duration: '2h'
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
