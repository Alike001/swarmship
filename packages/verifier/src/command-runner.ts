import { spawn } from "node:child_process";

export type CommandRequest = {
  args: readonly string[];
  command: string;
  cwd: string;
  maxOutputBytes: number;
  timeoutMs: number;
};

export type CommandResult = {
  exitCode: number | null;
  limitExceeded: boolean;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

export type CommandExecutor = (
  request: Readonly<CommandRequest>,
) => Promise<CommandResult>;

function appendBounded(
  current: string,
  chunk: Buffer,
  maximum: number,
): { limitExceeded: boolean; value: string } {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) <= maximum) {
    return { limitExceeded: false, value: next };
  }
  return {
    limitExceeded: true,
    value: Buffer.from(next).subarray(0, maximum).toString("utf8"),
  };
}

export const executeFixedCommand: CommandExecutor = async (request) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: {
        CARGO_HOME: process.env.CARGO_HOME,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        RUST_BACKTRACE: "0",
        RUSTUP_HOME: process.env.RUSTUP_HOME,
        TERM: "dumb",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let limitExceeded = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stdout, chunk, request.maxOutputBytes);
      stdout = appended.value;
      limitExceeded ||= appended.limitExceeded;
      if (limitExceeded) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stderr, chunk, request.maxOutputBytes);
      stderr = appended.value;
      limitExceeded ||= appended.limitExceeded;
      if (limitExceeded) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        limitExceeded,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
