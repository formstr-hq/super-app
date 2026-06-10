import * as formsService from "@formstr/agent/services/forms/service";
import type { FormTemplate, FormResponse } from "@formstr/agent/services/forms/types";
import { AnswerType } from "@formstr/agent/services/forms/types";
import { decodeNKeys } from "@formstr/core";
import { Box, Button, CircularProgress, Container, Divider, Typography } from "@mui/material";
import { generateSecretKey, getPublicKey, finalizeEvent, nip19, nip44 } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { validateAllAnswers } from "../components/forms/FieldInput";
import { FormFieldsRenderer } from "../components/forms/FormFieldsRenderer";
import { ResponderIdentityBar, type IdentityMode } from "../components/forms/ResponderIdentityBar";
import { useAuthStore } from "../stores";

export function FillPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const [form, setForm] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checkAnswers, setCheckAnswers] = useState<Record<string, Set<string>>>({});
  const [identityMode, setIdentityMode] = useState<IdentityMode>("anonymous");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!naddr) return;

    let pubkey: string;
    let identifier: string;
    let relayHints: string[] | undefined;
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("not naddr");
      const ptr = decoded.data as AddressPointer;
      pubkey = ptr.pubkey;
      identifier = ptr.identifier;
      relayHints = ptr.relays?.length ? ptr.relays : undefined;
    } catch {
      setError("Invalid form link");
      setLoading(false);
      return;
    }

    // View key, upstream priority order: `#nkeys…` fragment, then `?viewKey=` param
    // (formstr.app emits both link shapes).
    let viewKey: string | undefined;
    const hash = window.location.hash.slice(1); // strip leading "#"
    if (hash.startsWith("nkeys")) {
      try {
        viewKey = decodeNKeys(hash).viewKey;
      } catch {
        /* malformed fragment — ignore */
      }
    }
    if (!viewKey) {
      viewKey = new URLSearchParams(window.location.search).get("viewKey") ?? undefined;
    }

    formsService
      .fetchForm(pubkey, identifier, viewKey, relayHints)
      .then((f) => {
        setForm(f);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load form");
        setLoading(false);
      });
  }, [naddr]);

  const toggleCheck = (fieldId: string, optionId: string) =>
    setCheckAnswers((prev) => {
      const set = new Set(prev[fieldId] ?? []);
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      return { ...prev, [fieldId]: set };
    });

  const handleSubmit = async () => {
    if (!form) return;
    const issues = validateAllAnswers(form.fields, values, checkAnswers);
    if (issues.length > 0) {
      setFieldErrors(Object.fromEntries(issues.map((i) => [i.fieldId, i.message])));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      const responses: FormResponse[] = form.fields
        .filter((f) => f.type !== AnswerType.label && f.type !== AnswerType.section)
        .map((f) => {
          if (f.type === AnswerType.checkboxes) {
            return { fieldId: f.id, answer: JSON.stringify(Array.from(checkAnswers[f.id] ?? [])) };
          }
          return { fieldId: f.id, answer: values[f.id] ?? "" };
        });

      if (identityMode === "me" && isLoggedIn) {
        await formsService.submitResponse(
          form.pubkey,
          form.id,
          responses,
          form.isEncrypted,
          undefined,
          form.relays,
        );
      } else {
        // Anonymous: ephemeral key — sign and encrypt; discard key after publish
        const ephSk = generateSecretKey();
        const ephPubkey = getPublicKey(ephSk);
        const ephSigner = {
          getPublicKey: async () => ephPubkey,
          signEvent: async (e: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(e, ephSk),
          nip44Encrypt: async (recipientPubkey: string, plaintext: string) => {
            const convKey = nip44.v2.utils.getConversationKey(ephSk, recipientPubkey);
            return nip44.v2.encrypt(plaintext, convKey);
          },
        };
        await formsService.submitResponse(
          form.pubkey,
          form.id,
          responses,
          form.isEncrypted,
          ephSigner,
          form.relays,
        );
      }
      setSubmitted(true);
    } catch {
      setSubmitError("Could not submit your response. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !form) {
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <Typography color="error">{error ?? "Form not found"}</Typography>
      </Box>
    );
  }

  if (submitted) {
    return (
      <Box sx={{ textAlign: "center", pt: 8 }}>
        <Typography variant="h6">Response submitted!</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {form.settings?.thankYouText || `Thank you for filling out ${form.name}.`}
        </Typography>
      </Box>
    );
  }

  const requiresLogin =
    (form.settings?.disallowAnonymous ?? false) ||
    (form.settings?.allowedResponders?.length ?? 0) > 0;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      {/* Minimal header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h6" fontWeight={700}>
          formstr
        </Typography>
        {requiresLogin && !isLoggedIn && (
          <Button size="small" variant="outlined">
            Log in
          </Button>
        )}
      </Box>
      <Divider sx={{ mb: 3 }} />

      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        {form.name}
      </Typography>

      <ResponderIdentityBar
        mode={identityMode}
        onChange={setIdentityMode}
        requiresLogin={requiresLogin}
      />

      {form.isEncrypted && form.fields.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          This form is encrypted and the link is missing its view key, so the questions can&apos;t
          be displayed. Ask the form owner for a complete share link
          {!isLoggedIn ? ", or log in if you were granted access" : ""}.
        </Typography>
      ) : requiresLogin && !isLoggedIn ? (
        <Typography variant="body2" color="text.secondary">
          This form requires you to log in before filling it out.
        </Typography>
      ) : (
        <>
          <FormFieldsRenderer
            fields={form.fields}
            values={values}
            checkAnswers={checkAnswers}
            errors={fieldErrors}
            onChange={(fieldId, value) => setValues((prev) => ({ ...prev, [fieldId]: value }))}
            onToggleCheck={toggleCheck}
          />
          {submitError && (
            <Typography variant="body2" color="error" sx={{ mt: 2 }}>
              {submitError}
            </Typography>
          )}
          <Box sx={{ mt: 3 }}>
            <Button variant="contained" onClick={handleSubmit} disabled={submitting} fullWidth>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </Box>
        </>
      )}
    </Container>
  );
}
