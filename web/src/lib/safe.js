/** Only in-app paths: blocks open redirects such as ?next=//evil.com, ?next=/\evil.com or ?next=https://evil.com. */
export const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])[\w\-/?=&%.]*$/.test(n) ? n : null);
