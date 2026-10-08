import assert from "node:assert/strict";
import test from "node:test";
import { prepareNightlySnapshot, snapshotRequest } from "./payment_snapshot";

test("review payments are held and leave an audit notification", () => {
  const input = snapshotRequest.parse({
    snapshot_date: "2026-09-16",
    payment_events: [
      { payment_id: "pay-100", amount_cents: 4200, risk_level: "standard" },
      { payment_id: "pay-101", amount_cents: 8600, risk_level: "review" },
    ],
  });
  const snapshot = prepareNightlySnapshot(input, "2026-09-16T02:00:00.000Z");

  assert.equal(snapshot.risk_action, "hold_for_review");
  assert.deepEqual(snapshot.notifications, [
    { event: "snapshot.created", recorded_at: "2026-09-16T02:00:00.000Z" },
    { event: "payment.review_required", payment_id: "pay-101", recorded_at: "2026-09-16T02:00:00.000Z" },
  ]);
});
