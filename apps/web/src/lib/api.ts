export type ReleaseProjection = {
  approval: null | { approvedAt: string; digest: string; signer: string };
  build: null | { evidenceRef: string; sourceHash: string };
  deployment: null | {
    contractAddress: string | null;
    status: string;
    transactionHash: string | null;
    verificationStatus: string | null;
  };
  manifestAnchor: null | {
    proofRoot: string;
    status: string;
    transactionHash: string | null;
  };
  publicId: string;
  receipt: null | {
    anchorStatus: string | null;
    anchorTransactionHash: string | null;
    officialChainId: number;
    receiptRoot: string;
    witnessChainId: number;
  };
  releaseId: string;
  request: string;
  safeError: null | { code: string; message: string };
  specification: null | {
    owner: string;
    permittedReceiver: string;
    permittedSender: string;
  };
  specificationSummary: string | null;
  state: string;
  verification: null | {
    artifactHash: string;
    checks: { name: string; status: string }[];
    status: string;
  };
  version: number;
};

export type PublicRelease = {
  release: ReleaseProjection;
  transitions: {
    actor: string;
    createdAt: string;
    safeSummary: string | null;
    toState: string;
  }[];
};

export type ApprovalRequest = {
  digest: string;
  typedData: Record<string, unknown>;
};

const apiBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "";

async function readJson(response: Response): Promise<unknown> {
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new Error("The SwarmShip service returned an unreadable response.");
  }
  if (!response.ok) {
    const value = data as { error?: { message?: string } };
    throw new Error(
      value.error?.message ?? "SwarmShip could not complete this request.",
    );
  }
  return data;
}

export async function createRelease(
  request: string,
  idempotencyKey: string,
): Promise<ReleaseProjection> {
  const response = await fetch(`${apiBase}/api/releases`, {
    body: JSON.stringify({ request }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    method: "POST",
  });
  const data = (await readJson(response)) as { release: ReleaseProjection };
  return data.release;
}

export async function getPublicRelease(
  publicId: string,
): Promise<PublicRelease> {
  const response = await fetch(
    `${apiBase}/api/public/releases/${encodeURIComponent(publicId)}`,
  );
  return (await readJson(response)) as PublicRelease;
}

export async function getApprovalRequest(
  releaseId: string,
): Promise<ApprovalRequest> {
  const response = await fetch(
    `${apiBase}/api/releases/${encodeURIComponent(releaseId)}/approval`,
  );
  const data = (await readJson(response)) as { approval: ApprovalRequest };
  return data.approval;
}

export async function approveRelease(
  releaseId: string,
  expectedVersion: number,
  signature: string,
): Promise<void> {
  const response = await fetch(
    `${apiBase}/api/releases/${encodeURIComponent(releaseId)}/approval`,
    {
      body: JSON.stringify({ expectedVersion, signature }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  await readJson(response);
}
