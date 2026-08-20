import { relayManager, nostrRuntime } from "@formstr/core";
import { Box, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import type { AccentModule } from "../lib/moduleAccent";

const POLL_MS = 5000;
const SIZE = 16;
const CENTER = SIZE / 2;
const INNER = 2.6;
const OUTER = 7;

type ArmState = "connected" | "down" | "idle";

const ARM_COLOR: Record<ArmState, string> = {
  connected: "var(--fs-accent, currentColor)",
  down: "var(--fs-relay-down, #C4462F)",
  idle: "currentColor",
};

const ARM_OPACITY: Record<ArmState, number> = { connected: 1, down: 0.85, idle: 0.3 };

const LABEL: Record<ArmState, string> = {
  connected: "connected",
  down: "not responding",
  idle: "idle",
};

/**
 * The wordmark's asterisk, drawn as one arm per relay the active module
 * publishes to, lit by the pool's live connection state.
 *
 * The pool only tracks relays it has actually touched, so a relay missing from
 * the status map has not been contacted yet — that is "idle", not "down".
 * Reporting it as down would be a lie on every cold start.
 */
export function RelayStatus({ module }: { module: AccentModule }) {
  const relays = useMemo(() => relayManager.getRelaysForModule(module), [module]);
  const [status, setStatus] = useState<Map<string, boolean>>(() => new Map());

  useEffect(() => {
    const read = () => setStatus(new Map(nostrRuntime.pool.listConnectionStatus()));
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const arms: { url: string; state: ArmState }[] = relays.map((url) => {
    const connected = status.get(url);
    return { url, state: connected === undefined ? "idle" : connected ? "connected" : "down" };
  });

  const connectedCount = arms.filter((a) => a.state === "connected").length;
  // Half a step of rotation keeps an even arm count off the vertical/horizontal
  // axes, so four relays read as an asterisk rather than a plus sign.
  const step = 360 / arms.length;
  const base = -90 + step / 2;

  return (
    <Tooltip
      placement="bottom-end"
      title={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, py: 0.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {connectedCount} of {arms.length} relays connected
          </Typography>
          {arms.map(({ url, state }) => (
            <Typography key={url} variant="caption" sx={{ opacity: state === "idle" ? 0.6 : 1 }}>
              {url.replace(/^wss:\/\//, "")} — {LABEL[state]}
            </Typography>
          ))}
        </Box>
      }
    >
      <Box
        component="span"
        sx={{ display: "inline-flex", color: "text.secondary", flexShrink: 0, cursor: "default" }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${connectedCount} of ${arms.length} relays connected`}
        >
          {arms.map(({ url, state }, i) => {
            const rad = ((base + i * step) * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = Math.sin(rad);
            return (
              <line
                key={url}
                data-relay-arm={state}
                x1={(CENTER + dx * INNER).toFixed(2)}
                y1={(CENTER + dy * INNER).toFixed(2)}
                x2={(CENTER + dx * OUTER).toFixed(2)}
                y2={(CENTER + dy * OUTER).toFixed(2)}
                stroke={ARM_COLOR[state]}
                strokeOpacity={ARM_OPACITY[state]}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      </Box>
    </Tooltip>
  );
}
