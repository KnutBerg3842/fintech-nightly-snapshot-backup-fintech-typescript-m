import { z } from "zod";

export const snapshotRequest = z.object({
  snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_events: z.array(z.object({
    payment_id: z.string().min(1),
    amount_cents: z.number().int().positive(),
    risk_level: z.enum(["standard", "review"]),
  })).min(1),
});

export type SnapshotRequest = z.infer<typeof snapshotRequest>;

export type AuditNotification = {
  event: "snapshot.created" | "payment.review_required";
  payment_id?: string;
  recorded_at: string;
};

export function prepareNightlySnapshot(input: SnapshotRequest, recordedAt: string) {
  const reviewPayments = input.payment_events.filter((event) => event.risk_level === "review");
  const notifications: AuditNotification[] = [
    { event: "snapshot.created", recorded_at: recordedAt },
    ...reviewPayments.map((event) => ({
      event: "payment.review_required" as const,
      payment_id: event.payment_id,
      recorded_at: recordedAt,
    })),
  ];

  return {
    snapshot_date: input.snapshot_date,
    payment_events: input.payment_events,
    risk_action: reviewPayments.length ? "hold_for_review" : "archive",
    notifications,
  };
}
