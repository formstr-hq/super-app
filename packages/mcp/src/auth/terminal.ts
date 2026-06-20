import * as readline from "node:readline";
import { Writable } from "node:stream";

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
  // Route readline's output through a stream we can mute. On every keystroke
  // readline repaints the line by writing cursor-move + clear-screen escapes
  // (cursorTo / clearScreenDown) *straight to the output stream* — not through
  // the echo path. So to hide a passphrase we must mute the WHOLE stream, not
  // just the echoed characters: muting only the echo lets the clear sequence
  // wipe the prompt while the (muted) repaint never redraws it, leaving a blank
  // line and a process that looks hung. Letting readline paint the prompt and
  // muting immediately after keeps the prompt on screen and the input hidden.
  const stderr = process.stderr;
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) stderr.write(chunk as Buffer | string);
      cb();
    },
  });
  // Mirror the real terminal's shape so readline's cursor/wrap math matches.
  Object.defineProperties(output, {
    isTTY: { get: () => stderr.isTTY },
    columns: { get: () => stderr.columns },
    rows: { get: () => stderr.rows },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
  });

  return {
    prompt(question) {
      return new Promise((resolve) => rl.question(question, resolve));
    },
    promptPassphrase(question) {
      return new Promise((resolve) => {
        // question() paints the prompt synchronously; mute right after so the
        // keystroke repaints (and their clear sequences) emit nothing.
        rl.question(question, (answer) => {
          muted = false;
          stderr.write("\n");
          resolve(answer);
        });
        muted = true;
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
