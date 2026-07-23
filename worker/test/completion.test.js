import test from "node:test";
import assert from "node:assert/strict";
import { completionFailureAction, reconcileCompletionFailure } from "../src/worker.js";

const now = Date.parse("2026-07-23T12:00:00.000Z");
const activeState = {
  status: "processing",
  lease_token: "lease",
  lease_expires_at: "2026-07-23T12:05:00.000Z",
  result: {},
};

test("completed status wins even when the completion response was ambiguous", () => {
  assert.equal(
    completionFailureAction({ status: "completed", result: { primary_url: "https://example.test/output.webp" } }, "lease", false, now),
    "completed",
  );
});

test("only a definite completion failure under the active owned lease permits deletion", () => {
  assert.equal(completionFailureAction(activeState, "lease", true, now), "delete-and-fail");
  assert.equal(completionFailureAction(activeState, "lease", false, now), "keep-and-fail");
  assert.equal(completionFailureAction({ ...activeState, lease_token: "other" }, "lease", true, now), "keep-and-fail");
  assert.equal(
    completionFailureAction({ ...activeState, lease_expires_at: "2026-07-23T11:59:59.000Z" }, "lease", true, now),
    "keep-and-fail",
  );
  assert.equal(completionFailureAction({ status: "queued", result: {} }, "lease", true, now), "keep-and-fail");
  assert.equal(completionFailureAction(null, "lease", true, now), "keep-and-fail");
});

test("lease-loss reconciliation preserves queued, active, and reassigned job outputs", () => {
  const options = { leaseLost: true };
  assert.equal(completionFailureAction(activeState, "lease", true, now, options), "keep-and-stop");
  assert.equal(
    completionFailureAction({ ...activeState, lease_token: "other" }, "lease", true, now, options),
    "keep-and-stop",
  );
  assert.equal(completionFailureAction({ status: "queued", result: {} }, "lease", true, now, options), "keep-and-stop");
});

test("an expired final claim permits cleanup before the claim loop terminalizes it", () => {
  const expiredFinalState = {
    ...activeState,
    lease_expires_at: "2026-07-23T11:59:59.000Z",
    attempt_count: 3,
    max_attempts: 3,
  };
  assert.equal(
    completionFailureAction(expiredFinalState, "lease", true, now, { leaseLost: true }),
    "delete-and-stop",
  );
  assert.equal(
    completionFailureAction({ ...expiredFinalState, lease_token: "other" }, "lease", true, now, { leaseLost: true }),
    "keep-and-stop",
  );
});

test("terminal failed status permits cleanup only when no variants were committed", () => {
  assert.equal(completionFailureAction({ status: "failed", result: {} }, "lease", true, now), "delete-and-stop");
  assert.equal(
    completionFailureAction({ status: "failed", result: { variants: [] } }, "lease", false, now, { leaseLost: true }),
    "delete-and-stop",
  );
  assert.equal(
    completionFailureAction({ status: "failed", result: { variants: [{ variant_key: "image-640w-webp" }] } }, "lease", true, now),
    "keep-and-fail",
  );
  assert.equal(completionFailureAction({ status: "failed", result: null }, "lease", true, now), "keep-and-fail");
});

test("reconciliation treats an already-completed job as success without deleting outputs", async () => {
  let deleted = false;
  const api = {
    async getJobCompletionState() {
      return { status: "completed", result: { variants: [] } };
    },
    async deleteObjects() {
      deleted = true;
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "lease" },
    { uploadedObjects: [{ bucket: "project-media", path: "processed/output.webp" }] },
    { completionDefinitelyFailed: false },
    api,
    now,
  );

  assert.equal(result.action, "completed");
  assert.equal(deleted, false);
});

test("reconciliation best-effort deletes only objects created by this attempt", async () => {
  const deleted = [];
  const api = {
    async getJobCompletionState() {
      return activeState;
    },
    async deleteObjects(bucket, paths) {
      deleted.push({ bucket, paths });
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "lease" },
    {
      uploadedObjects: [
        { bucket: "project-media", path: "processed/new.avif" },
        { bucket: "project-media", path: "processed/new.webp" },
      ],
    },
    { completionDefinitelyFailed: true },
    api,
    now,
  );

  assert.equal(result.action, "delete-and-fail");
  assert.deepEqual(deleted, [{
    bucket: "project-media",
    paths: ["processed/new.avif", "processed/new.webp"],
  }]);
});

test("a completion cleanup failure does not replace the completion error path", async () => {
  const api = {
    async getJobCompletionState() {
      return activeState;
    },
    async deleteObjects() {
      throw new Error("Storage unavailable");
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "lease" },
    { uploadedObjects: [{ bucket: "project-media", path: "processed/output.webp" }] },
    { completionDefinitelyFailed: true },
    api,
    now,
  );

  assert.equal(result.action, "delete-and-fail");
});

test("reconciliation keeps outputs when the status query is ambiguous", async () => {
  let deleted = false;
  const api = {
    async getJobCompletionState() {
      throw new Error("Network unavailable");
    },
    async deleteObjects() {
      deleted = true;
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "lease" },
    { uploadedObjects: [{ bucket: "project-media", path: "processed/output.webp" }] },
    { completionDefinitelyFailed: true },
    api,
    now,
  );

  assert.equal(result.action, "keep-and-fail");
  assert.match(result.statusError.message, /Network unavailable/);
  assert.equal(deleted, false);
});

test("final failed reconciliation deletes only newly uploaded objects", async () => {
  const deleted = [];
  const api = {
    async getJobCompletionState() {
      return { status: "failed", result: {} };
    },
    async deleteObjects(bucket, paths) {
      deleted.push({ bucket, paths });
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "expired-lease" },
    {
      variants: [
        { object_path: "processed/pre-existing.webp" },
        { object_path: "processed/new.webp" },
      ],
      uploadedObjects: [{ bucket: "project-media", path: "processed/new.webp" }],
    },
    { code: "P0002", completionDefinitelyFailed: true },
    api,
    now,
    { leaseLost: true },
  );

  assert.equal(result.action, "delete-and-stop");
  assert.deepEqual(deleted, [{ bucket: "project-media", paths: ["processed/new.webp"] }]);
});

test("final failed reconciliation preserves outputs when committed variants are present", async () => {
  let deleted = false;
  const api = {
    async getJobCompletionState() {
      return { status: "failed", result: { variants: [{ variant_key: "image-640w-webp" }] } };
    },
    async deleteObjects() {
      deleted = true;
    },
  };

  const result = await reconcileCompletionFailure(
    { id: "job", leaseToken: "expired-lease" },
    { uploadedObjects: [{ bucket: "project-media", path: "processed/new.webp" }] },
    { code: "P0002", completionDefinitelyFailed: true },
    api,
    now,
    { leaseLost: true },
  );

  assert.equal(result.action, "keep-and-stop");
  assert.equal(deleted, false);
});
