import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TASK_REGISTRY_CONTRACT_FAMILY,
  validateTaskRegistrySpec,
  type TaskRegistrySpecV1,
} from "@swarmship/domain/release";

export const BUILD_TEMPLATE_VERSION = "agent-task-registry-v1@1";

export const BUILD_TEMPLATE_FILES = [
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "Stylus.toml",
  "contracts/agent-task-registry/Cargo.toml",
  "contracts/agent-task-registry/Stylus.toml",
  "contracts/agent-task-registry/src/lib.rs",
  "contracts/agent-task-registry/src/main.rs",
  "contracts/agent-task-registry/src/tests.rs",
] as const;

export type BuildRendererErrorCode =
  "invalid_specification" | "template_invalid" | "template_unavailable";

export class BuildRendererError extends Error {
  constructor(
    public readonly code: BuildRendererErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BuildRendererError";
  }
}

export type RenderedSourceFile = {
  content: string;
  path: (typeof BUILD_TEMPLATE_FILES)[number];
};

export type TaskRegistryTestInputsV1 = {
  constructor: {
    expiry: number;
    maxHandoffs: number;
    owner: string;
    permittedReceiver: string;
    permittedSender: string;
  };
  requiredChecks: readonly [
    "authorized_handoff",
    "unauthorized_sender",
    "duplicate_task",
    "maximum_handoff_limit",
    "expired_mandate",
  ];
  version: 1;
};

export type BuildEvidenceV1 = {
  contractFamily: "agent-task-registry-v1";
  evidenceRef: `0x${string}`;
  sourceFiles: RenderedSourceFile[];
  sourceHash: `0x${string}`;
  templateVersion: typeof BUILD_TEMPLATE_VERSION;
  testInputHash: `0x${string}`;
  testInputs: TaskRegistryTestInputsV1;
  version: 1;
};

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function hashBuildValue(tag: string, value: unknown): `0x${string}` {
  return `0x${createHash("sha256")
    .update(tag)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function normalizeContent(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n");
  if (normalized.includes("\0")) {
    throw new BuildRendererError(
      "template_invalid",
      "The fixed build template contains an invalid null byte.",
    );
  }
  return normalized;
}

async function loadSourceFiles(): Promise<RenderedSourceFile[]> {
  const canonicalRoot = await realpath(repositoryRoot);

  return Promise.all(
    BUILD_TEMPLATE_FILES.map(async (relativePath) => {
      const filePath = resolve(canonicalRoot, relativePath);
      if (!filePath.startsWith(`${canonicalRoot}${sep}`)) {
        throw new BuildRendererError(
          "template_invalid",
          "The fixed build template contains an unsafe path.",
        );
      }
      try {
        const [metadata, canonicalFile] = await Promise.all([
          lstat(filePath),
          realpath(filePath),
        ]);
        if (
          !metadata.isFile() ||
          !canonicalFile.startsWith(`${canonicalRoot}${sep}`)
        ) {
          throw new BuildRendererError(
            "template_invalid",
            "The fixed build template must contain regular repository files.",
          );
        }
        const content = normalizeContent(await readFile(canonicalFile, "utf8"));
        if (content.length === 0 || content.length > 160_000) {
          throw new BuildRendererError(
            "template_invalid",
            "A fixed build template file has an unsafe size.",
          );
        }
        return { content, path: relativePath };
      } catch (error) {
        if (error instanceof BuildRendererError) throw error;
        throw new BuildRendererError(
          "template_unavailable",
          "The fixed build template could not be read.",
        );
      }
    }),
  );
}

export async function renderTaskRegistry(
  specificationInput: unknown,
  nowUnixSeconds: number,
): Promise<BuildEvidenceV1> {
  const parsed = validateTaskRegistrySpec(specificationInput, nowUnixSeconds);
  if (!parsed.success) {
    throw new BuildRendererError(
      "invalid_specification",
      "The accepted specification is missing, expired, or inconsistent.",
    );
  }
  const specification: TaskRegistrySpecV1 = parsed.data;
  const sourceFiles = await loadSourceFiles();
  const sourceHash = hashBuildValue("swarmship-source-bundle-v1", sourceFiles);
  const testInputs: TaskRegistryTestInputsV1 = {
    constructor: {
      expiry: specification.expiry,
      maxHandoffs: specification.maxHandoffs,
      owner: specification.owner,
      permittedReceiver: specification.permittedReceiver,
      permittedSender: specification.permittedSender,
    },
    requiredChecks: [
      "authorized_handoff",
      "unauthorized_sender",
      "duplicate_task",
      "maximum_handoff_limit",
      "expired_mandate",
    ],
    version: 1,
  };
  const testInputHash = hashBuildValue("swarmship-test-inputs-v1", testInputs);
  const evidenceRef = hashBuildValue("swarmship-build-evidence-v1", {
    contractFamily: TASK_REGISTRY_CONTRACT_FAMILY,
    sourceHash,
    templateVersion: BUILD_TEMPLATE_VERSION,
    testInputHash,
    version: 1,
  });

  return {
    contractFamily: TASK_REGISTRY_CONTRACT_FAMILY,
    evidenceRef,
    sourceFiles,
    sourceHash,
    templateVersion: BUILD_TEMPLATE_VERSION,
    testInputHash,
    testInputs,
    version: 1,
  };
}
