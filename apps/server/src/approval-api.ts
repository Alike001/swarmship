import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import {
  RELEASE_MANIFEST_DOMAIN,
  RELEASE_MANIFEST_TYPES,
} from "@swarmship/domain/release";
import type { ApprovalRepository } from "@swarmship/persistence";

import {
  isJsonRequest,
  jsonError,
  releaseIdSchema,
} from "./http-validation.js";

export type ApprovalStore = Pick<ApprovalRepository, "approve" | "getRequest">;

const approvalSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

function presentApprovalRequest(
  request: Awaited<ReturnType<ApprovalStore["getRequest"]>>,
) {
  const manifest = request.manifest;
  return {
    digest: request.digest,
    manifest,
    summary: request.summary,
    typedData: {
      domain: RELEASE_MANIFEST_DOMAIN,
      types: RELEASE_MANIFEST_TYPES,
      primaryType: "ReleaseManifestV1",
      message: {
        version: manifest.version,
        releaseId: manifest.releaseId,
        specification: {
          owner: manifest.specification.owner,
          permittedSender: manifest.specification.permittedSender,
          permittedReceiver: manifest.specification.permittedReceiver,
          maxHandoffs: manifest.specification.maxHandoffs,
          expiry: manifest.specification.expiry,
        },
        sourceHash: manifest.sourceHash,
        artifactHash: manifest.artifactHash,
        testEvidenceHash: manifest.testEvidenceHash,
        toolchainHash: manifest.toolchainHash,
        chainId: manifest.chainId,
        nonce: manifest.nonce,
        approvalExpiry: manifest.approvalExpiry,
      },
    },
  };
}

export function registerApprovalRoutes(
  app: Hono,
  approvals: ApprovalStore,
): void {
  app.get("/api/releases/:releaseId/approval", async (context) => {
    const releaseId = releaseIdSchema.safeParse(context.req.param("releaseId"));
    if (!releaseId.success) {
      return context.json(
        jsonError("invalid_release_id", "The release identifier is invalid."),
        400,
      );
    }
    const request = await approvals.getRequest(
      releaseId.data,
      Math.floor(Date.now() / 1_000),
    );
    return context.json({ approval: presentApprovalRequest(request) });
  });

  app.post(
    "/api/releases/:releaseId/approval",
    bodyLimit({
      maxSize: 2 * 1024,
      onError: (context) =>
        context.json(
          jsonError(
            "request_too_large",
            "The approval request must be smaller than 2 KB.",
          ),
          413,
        ),
    }),
    async (context) => {
      const releaseId = releaseIdSchema.safeParse(
        context.req.param("releaseId"),
      );
      if (!releaseId.success) {
        return context.json(
          jsonError("invalid_release_id", "The release identifier is invalid."),
          400,
        );
      }
      if (!isJsonRequest(context.req.header("content-type"))) {
        return context.json(
          jsonError("unsupported_media_type", "Send this request as JSON."),
          415,
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
      const body = approvalSchema.safeParse(json);
      if (!body.success) {
        return context.json(
          jsonError(
            "invalid_approval",
            "Provide the current release version and a 65-byte wallet signature.",
          ),
          400,
        );
      }
      const result = await approvals.approve({
        expectedVersion: body.data.expectedVersion,
        nowUnixSeconds: Math.floor(Date.now() / 1_000),
        releaseId: releaseId.data,
        signature: body.data.signature,
      });
      return context.json(
        {
          created: result.created,
          approval: {
            approvedAt: result.approval.approvedAt,
            digest: result.approval.digest,
            signer: result.approval.signer,
          },
          release: {
            publicId: result.release.publicId,
            releaseId: result.release.id,
            state: result.release.state,
            version: result.release.version,
          },
        },
        result.created ? 201 : 200,
      );
    },
  );
}
