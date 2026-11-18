// All prices are conservative micro-USD reservations, not provider billing totals.
// The $1 opening balance reserves room for bounded integration probes outside this gateway.
export const SPEECH_BUDGET_ID = 'qwen-asr-lifetime-v1';
export const SPEECH_CAP = 24_000_000;
export const SPEECH_TEST_RESERVE = 1_000_000;
export const SPEECH_RATE = 120;
export const SPEECH_MAX_SECONDS = 300;
export const SPEECH_RESERVATION = (SPEECH_MAX_SECONDS + 2) * SPEECH_RATE;
export function speechCharge(bytes: number) { return bytes ? (Math.ceil(bytes / 32000) + 2) * SPEECH_RATE : 0; }
export const QWEN_BUDGET = { id: SPEECH_BUDGET_ID, cap: SPEECH_CAP, reserve: SPEECH_RESERVATION, tests: SPEECH_TEST_RESERVE, charge: speechCharge };
// Every re-decoded window and failed attempt is charged, not just microphone time.
// The provider key's shared $30 cap is an additional backstop for ASR + drawing.
export const ROUTER_BUDGET = { id: 'openrouter-asr-lifetime-v1', cap: 20_000_000, reserve: 1_000_000, tests: 1_000_000,
  charge: (billedSeconds: number) => Math.ceil(billedSeconds * 80) };

export async function reserveSpeech(db: D1Database, visitor: string, policy = QWEN_BUDGET) {
  const now = Date.now(), id = crypto.randomUUID();
  // Each INSERT / conditional UPDATE is atomic across isolates. An expired lease
  // frees capacity but never refunds money: a crashed worker stays conservatively charged.
  const lease = await db.prepare(`INSERT INTO speech_lease (id, visitor, expires, reserved, settled)
    SELECT ?, ?, ?, ?, 0 WHERE
    (SELECT COUNT(*) FROM speech_lease WHERE expires > ? AND settled = 0) < 8 AND
    (SELECT COUNT(*) FROM speech_lease WHERE visitor = ? AND expires > ? AND settled = 0) < 2 RETURNING id`)
    .bind(id, visitor, now + (SPEECH_MAX_SECONDS + 35) * 1000, policy.reserve, now, visitor, now).first();
  if (!lease) return { error: 'capacity' as const };
  try {
    await db.prepare('INSERT INTO speech_budget (id, used) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(policy.id, policy.tests).run();
    const budget = await db.prepare('UPDATE speech_budget SET used = used + ? WHERE id = ? AND used + ? <= ? RETURNING used')
      .bind(policy.reserve, policy.id, policy.reserve, policy.cap).first();
    if (budget) return { id };
  } catch { /* Fail closed: unavailable accounting must never permit spending. */ }
  await db.prepare('UPDATE speech_lease SET settled = 1 WHERE id = ?').bind(id).run();
  return { error: 'budget' as const };
}
export async function settleSpeech(db: D1Database, id: string, bytes: number, policy = QWEN_BUDGET) {
  const refund = Math.max(0, policy.reserve - policy.charge(bytes));
  // A D1 batch is transactional. The lease guard makes repeated cleanup idempotent.
  await db.batch([
    db.prepare('UPDATE speech_budget SET used = used - ? WHERE id = ? AND EXISTS (SELECT 1 FROM speech_lease WHERE id = ? AND settled = 0)').bind(refund, policy.id, id),
    db.prepare('UPDATE speech_lease SET settled = 1 WHERE id = ?').bind(id),
  ]);
}
export async function speechBudgetAvailable(db: D1Database, policy = QWEN_BUDGET) {
  const row = await db.prepare('SELECT used FROM speech_budget WHERE id = ?').bind(policy.id).first<{ used: number }>();
  return (row?.used ?? policy.tests) + policy.reserve <= policy.cap;
}
