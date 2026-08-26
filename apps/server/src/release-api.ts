import { createHash } from "node:crypto";

import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type {
  ReleaseRepository,
  ReleaseRow,
  ReleaseTransitionRow,
} from "@swarmship/persistence";

import {
  isJsonRequest,
  jsonError,
  publicReleaseIdSchema,
  releaseIdSchema,
} from "./http-validation.js";

export type ReleaseStore = Pick<
  ReleaseRepository,
  "create" | "get" | "getByPublicId" | "listTransitions"
>;

const createReleaseSchema = z.strictObject({
  request: z.string().trim().min(20).max(2_000),
});
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const safeErrorSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(300),
});

export function requestHash(request: string): `0x${string}` {
  const digest = createHash("sha256")
    .update(JSON.stringify({ request }))
    .digest("hex");
  return `0x${digest}`;
}

export function presentTransition(transition: ReleaseTransitionRow) {
  return {
    actor: transition.actor,
    createdAt: transition.createdAt.toISOString(),
    effects: transition.effects,
    event: transition.event,
    evidenceRef: transition.evidenceRef,
    fromState: transition.fromState,
    toState: transition.toState,
    safeSummary: transition.safeSummary,
    deterministicResult: transition.deterministicResult,
    toolName: transition.toolName,
    versionAfter: transition.versionAfter,
    versionBefore: transition.versionBefore,
  };
}

export function presentRelease(release: ReleaseRow) {
  const safeError = safeErrorSchema.safeParse(release.safeError);
  const build =
    release.buildEvidence === null
      ? null
      : {
          evidenceRef: release.buildEvidence.evidenceRef,
          sourceHash: release.buildEvidence.sourceHash,
          templateVersion: release.buildEvidence.templateVersion,
          testInputHash: release.buildEvidence.testInputHash,
        };
  const verification =
    release.verificationEvidence === null
      ? null
      : {
          artifactHash: release.verificationEvidence.artifactHash,
          checks: release.verificationEvidence.checks.map(
            ({ name, status }) => ({ name, status }),
          ),
          evidenceRef: release.verificationEvidence.evidenceRef,
          status: release.verificationEvidence.status,
          testEvidenceHash: release.verificationEvidence.testEvidenceHash,
          toolchainHash: release.verificationEvidence.toolchainHash,
        };
  const approval =
    release.manifestApproval === null
      ? null
      : {
          approvedAt: release.manifestApproval.approvedAt,
          digest: release.manifestApproval.digest,
          signer: release.manifestApproval.signer,
        };
  const manifestAnchor =
    release.manifestAnchorAttempt === null
      ? null
      : {
          proofRoot: release.manifestAnchorAttempt.proofRoot,
          status: release.manifestAnchorAttempt.status,
          transactionHash: release.manifestAnchorAttempt.transactionHash,
        };
  const deployment =
    release.deploymentAttempt === null
      ? null
      : {
          artifactHash: release.deploymentAttempt.artifactHash,
          contractAddress: release.deploymentAttempt.contractAddress,
          status: release.deploymentAttempt.status,
          transactionHash: release.deploymentAttempt.transactionHash,
          verificationStatus: release.deploymentAttempt.verificationStatus,
        };
  const receipt =
    release.receiptEvidence === null
      ? null
      : {
          anchorStatus: release.receiptAnchorAttempt?.status ?? null,
          anchorTransactionHash:
            release.receiptAnchorAttempt?.transactionHash ?? null,
          officialChainId: release.receiptEvidence.officialChainId,
          receipt: release.receiptEvidence.receipt,
          receiptRoot: release.receiptEvidence.receiptRoot,
          witnessChainId: release.receiptEvidence.witnessChainId,
        };
  return {
    approval,
    build,
    createdAt: release.createdAt.toISOString(),
    links: {
      approval: `/api/releases/${release.id}/approval`,
      proof: `/?proof=${release.publicId}`,
      self: `/api/releases/${release.id}`,
    },
    publicId: release.publicId,
    missingFields: release.missingFields ?? [],
    manifestAnchor,
    deployment,
    reconciliationKind: release.reconciliationKind,
    releaseId: release.id,
    request: release.originalRequest,
    safeError: safeError.success ? safeError.data : null,
    specification: release.specification,
    specificationSummary: release.specificationSummary,
    state: release.state,
    receipt,
    updatedAt: release.updatedAt.toISOString(),
    verification,
    version: release.version,
  };
}

export function registerReleaseRoutes(app: Hono, releases: ReleaseStore): void {
  app.post(
    "/api/releases",
    bodyLimit({
      maxSize: 8 * 1024,
      onError: (context) =>
        context.json(
          jsonError(
            "request_too_large",
            "The release request must be smaller than 8 KB.",
          ),
          413,
        ),
    }),
    async (context) => {
      if (!isJsonRequest(context.req.header("content-type"))) {
        return context.json(
          jsonError("unsupported_media_type", "Send this request as JSON."),
          415,
        );
      }

      const idempotency = idempotencyKeySchema.safeParse(
        context.req.header("idempotency-key"),
      );
      if (!idempotency.success) {
        return context.json(
          jsonError(
            "invalid_idempotency_key",
            "Provide an Idempotency-Key with 8 to 128 safe characters.",
          ),
          400,
        );
      }

      let json: unknown;
      try {
        json = await context.req.json();
      } catch {
        return context.json(
          jsonError("invalid_json", "The request body must be valid JSON."),
          400,
        );
      }
      const body = createReleaseSchema.safeParse(json);
      if (!body.success) {
        return context.json(
          jsonError(
            "invalid_release_request",
            "Describe one bounded task registry in 20 to 2,000 characters.",
          ),
          400,
        );
      }

      const result = await releases.create({
        idempotency: {
          callerScope: "public_api",
          key: idempotency.data,
          operation: "create_release",
          requestHash: requestHash(body.data.request),
        },
        originalRequest: body.data.request,
      });
      context.header("Location", `/api/releases/${result.release.id}`);
      return context.json(
        { created: result.created, release: presentRelease(result.release) },
        result.created ? 201 : 200,
      );
    },
  );

  app.get("/api/releases/:releaseId", async (context) => {
    const releaseId = releaseIdSchema.safeParse(context.req.param("releaseId"));
    if (!releaseId.success) {
      return context.json(
        jsonError("invalid_release_id", "The release identifier is invalid."),
        400,
      );
    }
    const release = await releases.get(releaseId.data);
    if (release === null) {
      return context.json(
        jsonError("release_not_found", "Release not found."),
        404,
      );
    }
    const transitions = await releases.listTransitions(release.id);
    return context.json({
      release: presentRelease(release),
      transitions: transitions.map(presentTransition),
    });
  });

  app.get("/api/public/releases/:publicId", async (context) => {
    const publicId = publicReleaseIdSchema.safeParse(
      context.req.param("publicId"),
    );
    if (!publicId.success) {
      return context.json(
        jsonError(
          "invalid_public_id",
          "The public proof identifier is invalid.",
        ),
        400,
      );
    }
    const release = await releases.getByPublicId(publicId.data);
    if (release === null) {
      return context.json(
        jsonError("release_not_found", "Release not found."),
        404,
      );
    }
    const transitions = await releases.listTransitions(release.id);
    return context.json({
      release: presentRelease(release),
      transitions: transitions.map(presentTransition),
    });
  });
}
