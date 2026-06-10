import * as readline from "node:readline";

import QRCode from "qrcode";

/**
 * Interactive terminal I/O for the login flow. Reads from stdin and writes prompts
 * to **stderr** (stdout is reserved for the MCP stdio protocol when `run`ning;
 * `login` doesn't speak it, but keeping prompts on stderr is consistent).
 *
 * `doLogin` takes these as injected deps so it can be unit-tested with fakes.
 */
export interface TerminalIo {
  prompt(question: string): Promise<string>;
  /** Reads a line without echoing keystrokes (for passphrases). */
  promptPassphrase(question: string): Promise<string>;
  close(): void;
}

export function createTerminalIo(): TerminalIo {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  return {
    prompt(question) {
      return new Promise((resolve) => rl.question(question, resolve));
    },
    promptPassphrase(question) {
      return new Promise((resolve) => {
        // Mute echo: swallow the interface's output for the duration of the read,
        // then restore it. The prompt itself is written once up front.
        process.stderr.write(question);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const muted = rl as any;
        const original = muted._writeToOutput?.bind(rl);
        muted._writeToOutput = () => {};
        rl.question("", (answer) => {
          muted._writeToOutput = original;
          process.stderr.write("\n");
          resolve(answer);
        });
      });
    },
    close() {
      rl.close();
    },
  };
}

/** Render a NIP-46 URI as a terminal QR code (plus the raw URI) on stderr. */
export function printQr(uri: string): void {
  QRCode.toString(uri, { type: "terminal", small: true })
    .then((qr) => {
      process.stderr.write("\n" + qr + "\n");
      process.stderr.write(uri + "\n\n");
    })
    .catch(() => {
      process.stderr.write("\n" + uri + "\n\n");
    });
}
