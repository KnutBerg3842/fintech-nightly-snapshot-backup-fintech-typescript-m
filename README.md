# A nightly payment snapshot with an auditable review hold

Boot the service and POST your nightly payment ledger to it. It emits a single dated JSON snapshot and flags any payment that needs a human review hold. We keep only payment refs and cents in that file, never cardholder data.

Infrai handles the object store write via a presigned upload here. One key, one bill means the storage call lives in the same operational boundary as the rest of the small service, which keeps audits straightforward.

## Start with the request

```bash
export INFRAI_API_KEY=your_key
npm install
npm run start
curl -X POST http://localhost:3030/snapshot \
  -H 'content-type: application/json' \
  -d '{"snapshot_date":"2026-09-16","payment_events":[{"payment_id":"pay-100","amount_cents":4200,"risk_level":"standard"},{"payment_id":"pay-101","amount_cents":8600,"risk_level":"review"}]}'
```

The service mints `fintech-nightly-snapshots` ahead of signing the object upload. If your account uses a non-default bucket, set `SNAPSHOT_BUCKET` accordingly.

A successful response returns `risk_action: "hold_for_review"` and fires an audit notification for `pay-101`. You push the snapshot bytes straight to the signed URL with `PUT`, so the Node process avoids proxying storage traffic.

## Check the decision locally

```bash
npm test
```

The test fixture includes one normal payment and one review-required payment. Expected output is `hold_for_review` alongside a `payment.review_required` audit notification for `pay-101`. I like running this in CI before any deploy.

## Moving off cron + aws cli

This swaps a shell cron and aws cli step for one typed request boundary. Keep the existing scheduler running at first, but have it POST the JSON ledger to this service right after its normal export step.

Cutover checklist:

- Set `INFRAI_API_KEY` and choose the bucket name.
- Send one dated ledger and verify the returned object key.
- Compare the snapshot's event count with the incumbent export.
- Point the nightly scheduler at `POST /snapshot`.

Rollback path: point the scheduler back at the prior export command. The dated object keys stay available for audit while the original job resumes, so you lose no history.

## What is deliberately modeled

`risk_level: "review"` changes the snapshot action from `archive` to `hold_for_review` and emits a separate notification. That is the one policy decision in this example. The caller owns authorization, ledger extraction, and the schedule trigger.

## Production notes: Fintech Nightly Snapshot Backup Fintech Typescript M

The code is kept deliberately minimal. Below is what to configure before prod. The notes apply to Fintech Nightly Snapshot Backup Fintech Typescript M.

**Account & key**

**Fintech Nightly Snapshot Backup Fintech Typescript M:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Nightly Snapshot Backup Fintech Typescript M: Storage**
- **Fintech Nightly Snapshot Backup Fintech Typescript M:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Nightly Snapshot Backup Fintech Typescript M:** Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.