import {
  AnswerType,
  type FormResponseEvent,
  type FormTemplate,
} from "@formstr/agent/services/forms/types";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { Copy, Download } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useState } from "react";

import { copyText } from "../../lib/clipboard";
import {
  downloadTextFile,
  renderAnswer,
  responsesToCsv,
  responsesToJson,
} from "../../lib/exportResponses";
import { formatNpub } from "../../lib/npub";

import { FormAnalytics } from "./FormAnalytics";

interface Props {
  open: boolean;
  form: FormTemplate | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  onClose: () => void;
}

export function ResponsesDialog({ open, form, responses, isLoading, onClose }: Props) {
  const [tab, setTab] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState("");

  const handleCopyNpub = async (pubkeyHex: string) => {
    let npub = pubkeyHex;
    try {
      npub = nip19.npubEncode(pubkeyHex);
    } catch {
      /* malformed pubkey — copy the raw value */
    }
    const ok = await copyText(npub);
    setCopyFeedback(ok ? "npub copied" : "Copy failed");
  };

  const handleExportCsv = () => {
    if (!form) return;
    downloadTextFile(
      `${form.name || "form"}-responses.csv`,
      "text/csv",
      responsesToCsv(form, responses),
    );
  };
  const handleExportJson = () => {
    downloadTextFile(
      `${form?.name || "form"}-responses.json`,
      "application/json",
      responsesToJson(responses),
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { maxHeight: "85vh" } }}
    >
      <DialogTitle>
        Responses — {form?.name ?? "Loading…"}
        {!isLoading && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            ({responses.length})
          </Typography>
        )}
      </DialogTitle>

      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Responses" />
        <Tab label="Analytics" />
      </Tabs>

      <DialogContent dividers sx={{ overflowX: "auto", overflowY: "auto" }}>
        {isLoading || !form ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="text" />
            ))}
          </Box>
        ) : tab === 0 ? (
          responses.length === 0 ? (
            <Box sx={{ py: 6, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                No responses yet.
              </Typography>
            </Box>
          ) : (
            <Table size="small" sx={{ minWidth: 600 }}>
              <TableHead>
                <TableRow
                  sx={{ "& th": { fontWeight: 600, fontSize: 12, color: "text.secondary" } }}
                >
                  <TableCell>#</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Responder</TableCell>
                  {form.fields
                    .filter((f) => f.type !== AnswerType.label)
                    .map((f) => (
                      <TableCell key={f.id}>{f.label || "—"}</TableCell>
                    ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {responses.map((r, ri) => {
                  const byId: Record<string, string> = {};
                  r.responses.forEach((rr) => {
                    byId[rr.fieldId] = rr.answer;
                  });
                  return (
                    <TableRow key={r.id} hover>
                      <TableCell>
                        <Typography variant="caption">{ri + 1}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(r.createdAt * 1000).toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                            {formatNpub(r.pubkey)}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => void handleCopyNpub(r.pubkey)}
                            aria-label="Copy responder npub"
                          >
                            <Copy size={11} />
                          </IconButton>
                        </Box>
                      </TableCell>
                      {form.fields
                        .filter((f) => f.type !== AnswerType.label)
                        .map((f) => (
                          <TableCell key={f.id}>
                            <Typography variant="caption">
                              {renderAnswer(f, byId[f.id] ?? "")}
                            </Typography>
                          </TableCell>
                        ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : (
          <FormAnalytics form={form} responses={responses} />
        )}
      </DialogContent>

      <DialogActions>
        <Button
          size="small"
          startIcon={<Download size={14} />}
          onClick={handleExportCsv}
          disabled={responses.length === 0}
        >
          CSV
        </Button>
        <Button
          size="small"
          startIcon={<Download size={14} />}
          onClick={handleExportJson}
          disabled={responses.length === 0}
        >
          JSON
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      <Snackbar
        open={!!copyFeedback}
        autoHideDuration={2000}
        onClose={() => setCopyFeedback("")}
        message={copyFeedback}
      />
    </Dialog>
  );
}
