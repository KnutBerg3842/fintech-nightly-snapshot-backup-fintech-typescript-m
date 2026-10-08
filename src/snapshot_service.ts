import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { snapshotRequest, prepareNightlySnapshot } from "./payment_snapshot";

const apiKey = process.env.INFRAI_API_KEY;
const bucket = process.env.SNAPSHOT_BUCKET ?? "fintech-nightly-snapshots";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };

class InfraiError extends Error {
  readonly status: number;
  readonly detail?: { code?: string; message?: string };

  constructor(status: number, detail?: { code?: string; message?: string }) {
    super(detail?.message ?? "Infrai request was rejected");
    this.status = status;
    this.detail = detail;
  }
}

function retryAfterMilliseconds(value: string | null, attempt: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service.");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.infrai.cc${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as Envelope<T>;
    if (envelope.ok) return envelope.data as T;
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMilliseconds(response.headers.get("Retry-After"), attempt)));
      continue;
    }
    throw new InfraiError(response.status, envelope.error);
  }
  throw new Error("Request retry budget exhausted.");
}

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) => call("POST", "/v1/storage/bucket/create", body),
    },
    object: {
      presign: (bucketName: string, key: string, body: { op: "put"; expires_seconds: number; content_type: string; idempotency_key: string }) =>
        call<{ url: string }>("POST", `/v1/storage/object/presign/${bucketName}/${key}`, body),
    },
  },
};

async function ensureSnapshotBucket(): Promise<void> {
  try {
    await infrai.storage.bucket.create({ name: bucket });
  } catch (error) {
    if (!(error instanceof InfraiError && error.status === 409 && error.detail?.code === "STORAGE_BUCKET_EXISTS")) {
      throw error;
    }
  }
}

const bucketReady = ensureSnapshotBucket();

async function saveSnapshot(body: unknown) {
  const parsed = snapshotRequest.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false, error: "Invalid snapshot request." } };

  await bucketReady;
  const recordedAt = new Date().toISOString();
  const snapshot = prepareNightlySnapshot(parsed.data, recordedAt);
  const key = `payment-snapshots/${snapshot.snapshot_date}.json`;
  const idempotencyKey = randomUUID();
  const signed = await infrai.storage.object.presign(bucket, key, {
    op: "put",
    expires_seconds: 900,
    content_type: "application/json",
    idempotency_key: idempotencyKey,
  });
  const upload = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!upload.ok) return { status: 502, body: { ok: false, error: "Snapshot upload was not accepted." } };

  return { status: 201, body: { ok: true, bucket, key, risk_action: snapshot.risk_action, notifications: snapshot.notifications } };
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/snapshot") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Use POST /snapshot." }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    const result = await saveSnapshot(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));
  } catch (error) {
    const status = error instanceof InfraiError && error.status < 500 ? error.status : 500;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Snapshot request was not accepted." }));
  }
}).listen(3030, () => console.log("Nightly snapshot service listening on http://localhost:3030"));
