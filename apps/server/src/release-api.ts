import { createHash } from "node:crypto";

import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type {
  ReleaseRepository,
  ReleaseRow,
  ReleaseTransitionRow,
} from "@swarmship/persistence";

export type ReleaseStore = Pick<
  ReleaseRepository,
  "create" | "get" | "listTransitions"
>;

const createReleaseSchema = z.strictObject({
  request: z.string().trim().min(20).max(2_000),
});
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const releaseIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
const safeErrorSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(300),
});

function jsonError(code: string, message: string) {
  return { error: { code, message } };
}

function isJsonRequest(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

function requestHash(request: string): `0x${string}` {
  const digest = createHash("sha256")
    .update(JSON.stringify({ request }))
    .digest("hex");
  return `0x${digest}`;
}

function presentTransition(transition: ReleaseTransitionRow) {
  return {
    actor: transition.actor,
    createdAt: transition.createdAt.toISOString(),
    effects: transition.effects,
    event: transition.event,
    evidenceRef: transition.evidenceRef,
    fromState: transition.fromState,
    toState: transition.toState,
    versionAfter: transition.versionAfter,
    versionBefore: transition.versionBefore,
  };
}

function presentRelease(release: ReleaseRow) {
  const safeError = safeErrorSchema.safeParse(release.safeError);
  return {
    createdAt: release.createdAt.toISOString(),
    links: {
      approval: `/releases/${release.id}/approve`,
      proof: `/proof/${release.publicId}`,
      self: `/api/releases/${release.id}`,
    },
    publicId: release.publicId,
    reconciliationKind: release.reconciliationKind,
    releaseId: release.id,
    request: release.originalRequest,
    safeError: safeError.success ? safeError.data : null,
    state: release.state,
    updatedAt: release.updatedAt.toISOString(),
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
}
