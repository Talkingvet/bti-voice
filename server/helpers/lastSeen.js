// Tiny in-memory "last seen" markers for the portal's health view
// (GET /api/tenant/health-extended). Records when the last Twilio webhook of
// each kind arrived so BTI can spot a deploy whose webhooks stopped (wrong
// URL after a domain change, Twilio misconfig) without reading Railway logs.
// In-memory on purpose: resets on deploy, which is itself useful to see.
const seen = { boot: new Date().toISOString() };
function mark(kind) { seen[kind] = new Date().toISOString(); }
function getLastSeen() { return { ...seen }; }
module.exports = { mark, getLastSeen };
