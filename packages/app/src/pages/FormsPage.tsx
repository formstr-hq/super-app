import {
  BarChart3,
  Check,
  FileText,
  GripVertical,
  Lock,
  Plus,
  PlusCircle,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";

import {
  AnswerType,
  type FormField,
  type FormTemplate,
  type FormResponse,
  type FormResponseEvent,
  type FormSummary,
} from "../services/forms";
import * as formsService from "../services/forms/service";
import { useFormsStore } from "../stores";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";


// ── Answer type label map ────────────────────────────────

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

// ── Skeleton card ───────────────────────────────────────

function FormCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-16" />
      </CardContent>
    </Card>
  );
}

// ── Main page ────────────────────────────────────────────

type ActiveDialog = "none" | "create" | "fill" | "responses";

export function FormsPage() {
  const {
    myForms,
    currentForm,
    responses,
    isLoading,
    error,
    fetchMyForms,
    createForm,
    deleteForm,
    loadForm,
    loadResponses,
    clearCurrent,
  } = useFormsStore();

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);

  useEffect(() => {
    fetchMyForms();
  }, [fetchMyForms]);

  const handleOpenFill = useCallback(
    (form: FormSummary) => {
      setSelectedForm(form);
      loadForm(form.pubkey, form.id);
      setActiveDialog("fill");
    },
    [loadForm],
  );

  const handleOpenResponses = useCallback(
    (form: FormSummary) => {
      setSelectedForm(form);
      loadForm(form.pubkey, form.id);
      loadResponses(form.pubkey, form.id);
      setActiveDialog("responses");
    },
    [loadForm, loadResponses],
  );

  const handleClose = useCallback(() => {
    setActiveDialog("none");
    setSelectedForm(null);
    clearCurrent();
  }, [clearCurrent]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Forms</h1>
          <Button size="sm" onClick={() => setActiveDialog("create")} className="cursor-pointer">
            <Plus className="h-4 w-4 mr-1.5" />
            New Form
          </Button>
        </div>

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Loading */}
        {isLoading && myForms.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <FormCardSkeleton key={i} />
            ))}
          </div>
        ) : myForms.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <p className="font-medium text-sm">No forms yet</p>
            <p className="text-sm text-muted-foreground">Create your first form to get started</p>
            <Button
              size="sm"
              onClick={() => setActiveDialog("create")}
              className="cursor-pointer mt-1"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New Form
            </Button>
          </div>
        ) : (
          /* Form grid */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myForms.map((form) => (
              <Card
                key={`${form.pubkey}:${form.id}`}
                className="group hover:shadow-md transition-shadow duration-150 cursor-pointer"
                onClick={() => handleOpenFill(form)}
              >
                <CardContent className="p-4">
                  {/* Name row */}
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{form.name}</span>
                  </div>

                  {/* Date */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(form.createdAt * 1000).toLocaleDateString()}
                  </p>

                  {/* Encrypted badge */}
                  {form.isEncrypted && (
                    <Badge variant="secondary" className="mt-2">
                      <Lock className="h-3 w-3 mr-1" />
                      Encrypted
                    </Badge>
                  )}

                  {/* Actions row */}
                  <div
                    className="mt-3 pt-3 border-t border-border flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 cursor-pointer"
                          onClick={() => handleOpenFill(form)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Fill form</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 cursor-pointer"
                          onClick={() => handleOpenResponses(form)}
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Responses</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-destructive"
                          onClick={() => deleteForm(form.id, form.pubkey)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Dialogs */}
        <CreateFormDialog
          open={activeDialog === "create"}
          onClose={handleClose}
          onCreate={createForm}
        />

        <FormFillerDialog
          open={activeDialog === "fill"}
          form={currentForm}
          formSummary={selectedForm}
          isLoading={isLoading}
          onClose={handleClose}
        />

        <ResponsesDialog
          open={activeDialog === "responses"}
          form={currentForm}
          formSummary={selectedForm}
          responses={responses}
          isLoading={isLoading}
          onClose={handleClose}
        />
      </div>
    </TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════
// Create Form Dialog — enhanced
// ═══════════════════════════════════════════════════════════

interface CreateFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (params: {
    name: string;
    fields: FormField[];
    settings?: { publicForm?: boolean; description?: string };
    encrypt?: boolean;
  }) => Promise<unknown>;
}

function CreateFormDialog({ open, onClose, onCreate }: CreateFormDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [encrypt, setEncrypt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const addField = () => {
    setFields([
      ...fields,
      {
        id: crypto.randomUUID().slice(0, 8),
        type: AnswerType.shortText,
        label: "",
        required: false,
        options: [],
      },
    ]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    // If switching to a choice type and no options yet, add two defaults
    if (updates.type && CHOICE_TYPES.has(updates.type) && !updated[index].options?.length) {
      updated[index].options = [
        { id: crypto.randomUUID().slice(0, 6), label: "Option 1" },
        { id: crypto.randomUUID().slice(0, 6), label: "Option 2" },
      ];
    }
    setFields(updated);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const addOption = (fieldIndex: number) => {
    const updated = [...fields];
    const opts = [...(updated[fieldIndex].options ?? [])];
    opts.push({ id: crypto.randomUUID().slice(0, 6), label: `Option ${opts.length + 1}` });
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const updateOption = (fieldIndex: number, optIndex: number, label: string) => {
    const updated = [...fields];
    const opts = [...(updated[fieldIndex].options ?? [])];
    opts[optIndex] = { ...opts[optIndex], label };
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const removeOption = (fieldIndex: number, optIndex: number) => {
    const updated = [...fields];
    const opts = (updated[fieldIndex].options ?? []).filter((_, i) => i !== optIndex);
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    setDialogError(null);
    try {
      await onCreate({
        name,
        fields,
        settings: {
          publicForm: !encrypt,
          description: description || undefined,
        },
        encrypt,
      });
      setName("");
      setDescription("");
      setFields([]);
      setEncrypt(false);
      setDialogError(null);
      onClose();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : "Failed to create form");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && fields.length > 0 && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>New Form</DialogTitle>
          <DialogDescription>Add a title and questions to your form.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3 -mr-3">
          <div className="space-y-4 py-2">
            {/* Form title */}
            <div className="space-y-1.5">
              <Label htmlFor="form-title">Form title</Label>
              <Input
                id="form-title"
                placeholder="Untitled form"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="form-desc">Description (optional)</Label>
              <textarea
                id="form-desc"
                className={cn(
                  "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2",
                  "text-sm ring-offset-background placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:cursor-not-allowed disabled:opacity-50 resize-none",
                )}
                placeholder="Describe your form…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Encrypt toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="form-encrypt"
                checked={encrypt}
                onCheckedChange={(v) => setEncrypt(v === true)}
              />
              <Label htmlFor="form-encrypt" className="text-sm cursor-pointer">
                Encrypt form (only you can see responses)
              </Label>
            </div>

            {/* Questions section */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Questions</span>
                <Separator className="flex-1" />
              </div>

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      {/* Drag handle */}
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/30" />

                      {/* Question label */}
                      <Input
                        className="flex-1"
                        placeholder="Question…"
                        value={field.label}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                      />

                      {/* Type select */}
                      <Select
                        value={field.type}
                        onValueChange={(val) => updateField(index, { type: val as AnswerType })}
                      >
                        <SelectTrigger className="w-35 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AnswerType.shortText}>Short answer</SelectItem>
                          <SelectItem value={AnswerType.paragraph}>Paragraph</SelectItem>
                          <SelectItem value={AnswerType.radioButton}>Multiple choice</SelectItem>
                          <SelectItem value={AnswerType.checkboxes}>Checkboxes</SelectItem>
                          <SelectItem value={AnswerType.dropdown}>Dropdown</SelectItem>
                          <SelectItem value={AnswerType.number}>Number</SelectItem>
                          <SelectItem value={AnswerType.date}>Date</SelectItem>
                          <SelectItem value={AnswerType.time}>Time</SelectItem>
                          <SelectItem value={AnswerType.datetime}>Date & time</SelectItem>
                          <SelectItem value={AnswerType.label}>Label</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Required toggle */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "text-xs px-1.5 py-0.5 rounded border cursor-pointer",
                              field.required
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/50",
                            )}
                            onClick={() => updateField(index, { required: !field.required })}
                          >
                            Req
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {field.required ? "Mark optional" : "Mark required"}
                        </TooltipContent>
                      </Tooltip>

                      {/* Delete field */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 cursor-pointer shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeField(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Options editor for choice types */}
                    {CHOICE_TYPES.has(field.type) && (
                      <div className="pl-6 space-y-1.5">
                        {(field.options ?? []).map((opt, oi) => (
                          <div key={opt.id} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-4 text-right">
                              {oi + 1}.
                            </span>
                            <Input
                              className="flex-1 h-7 text-sm"
                              value={opt.label}
                              onChange={(e) => updateOption(index, oi, e.target.value)}
                              placeholder={`Option ${oi + 1}`}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 cursor-pointer shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removeOption(index, oi)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="cursor-pointer text-xs text-muted-foreground h-7"
                          onClick={() => addOption(index)}
                        >
                          <PlusCircle className="h-3 w-3 mr-1" />
                          Add option
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add question */}
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer text-muted-foreground"
                onClick={addField}
              >
                <PlusCircle className="h-4 w-4 mr-1.5" />
                Add question
              </Button>
            </div>
          </div>
        </ScrollArea>

        {/* Inline error above footer */}
        {dialogError && <p className="text-xs text-destructive">{dialogError}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="cursor-pointer"
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit} className="cursor-pointer">
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════
// Form Filler Dialog — interactive form filling + submit
// ═══════════════════════════════════════════════════════════

function FormFillerDialog({
  open,
  form,
  formSummary,
  isLoading,
  onClose,
}: {
  open: boolean;
  form: FormTemplate | null;
  formSummary: FormSummary | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checkAnswers, setCheckAnswers] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state when form changes
  useEffect(() => {
    if (form) {
      setAnswers({});
      setCheckAnswers({});
      setSubmitted(false);
      setSubmitError(null);
    }
  }, [form?.id]);

  const setAnswer = (fieldId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  };

  const toggleCheck = (fieldId: string, optionId: string) => {
    setCheckAnswers((prev) => {
      const set = new Set(prev[fieldId] ?? []);
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      return { ...prev, [fieldId]: set };
    });
  };

  const handleSubmit = async () => {
    if (!form || !formSummary) return;

    // Validate required fields
    const missing = form.fields.filter((f) => {
      if (!f.required) return false;
      if (f.type === AnswerType.checkboxes) return !checkAnswers[f.id]?.size;
      return !answers[f.id]?.trim();
    });
    if (missing.length > 0) {
      setSubmitError(`Please fill required fields: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const responses: FormResponse[] = form.fields
        .filter((f) => f.type !== AnswerType.label)
        .map((f) => {
          let answer = answers[f.id] ?? "";
          if (f.type === AnswerType.checkboxes) {
            const selected = Array.from(checkAnswers[f.id] ?? []);
            answer = JSON.stringify(selected);
          }
          return { fieldId: f.id, answer };
        });

      await formsService.submitResponse(
        formSummary.pubkey,
        formSummary.id,
        responses,
        formSummary.isEncrypted,
      );
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{form?.name ?? formSummary?.name ?? "Loading…"}</DialogTitle>
          {form?.settings.description && (
            <DialogDescription>{form.settings.description}</DialogDescription>
          )}
        </DialogHeader>

        {isLoading || !form ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : submitted ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <p className="font-medium">Response submitted!</p>
            <p className="text-sm text-muted-foreground">Thank you for filling out this form.</p>
            <Button variant="outline" size="sm" onClick={onClose} className="cursor-pointer mt-2">
              Close
            </Button>
          </div>
        ) : form.fields.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {form.isEncrypted
                ? "This form is encrypted and cannot be decrypted with your key."
                : "This form has no fields."}
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 pr-3 -mr-3">
              <div className="space-y-5 py-2">
                {form.fields.map((field) => (
                  <FieldRenderer
                    key={field.id}
                    field={field}
                    value={answers[field.id] ?? ""}
                    checkedValues={checkAnswers[field.id]}
                    onChange={(v) => setAnswer(field.id, v)}
                    onToggleCheck={(optId) => toggleCheck(field.id, optId)}
                  />
                ))}
              </div>
            </ScrollArea>

            {submitError && <p className="text-xs text-destructive">{submitError}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} className="cursor-pointer">
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting} className="cursor-pointer">
                {submitting ? (
                  "Submitting…"
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1.5" />
                    Submit
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Field renderer ───────────────────────────────────────

function FieldRenderer({
  field,
  value,
  checkedValues,
  onChange,
  onToggleCheck,
}: {
  field: FormField;
  value: string;
  checkedValues?: Set<string>;
  onChange: (value: string) => void;
  onToggleCheck: (optionId: string) => void;
}) {
  const labelEl = (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Label className="text-sm font-medium">{field.label || "Untitled"}</Label>
      {field.required && <span className="text-destructive text-xs">*</span>}
    </div>
  );

  switch (field.type) {
    case AnswerType.shortText:
      return (
        <div>
          {labelEl}
          <Input
            placeholder={field.placeholder || "Your answer"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case AnswerType.paragraph:
      return (
        <div>
          {labelEl}
          <textarea
            className={cn(
              "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2",
              "text-sm ring-offset-background placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "resize-none",
            )}
            placeholder={field.placeholder || "Your answer"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
          />
        </div>
      );

    case AnswerType.radioButton:
      return (
        <div>
          {labelEl}
          <RadioGroup value={value} onValueChange={onChange} className="space-y-1.5">
            {(field.options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <RadioGroupItem value={opt.id} id={`r-${field.id}-${opt.id}`} />
                <Label
                  htmlFor={`r-${field.id}-${opt.id}`}
                  className="text-sm cursor-pointer font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );

    case AnswerType.checkboxes:
      return (
        <div>
          {labelEl}
          <div className="space-y-1.5">
            {(field.options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Checkbox
                  id={`c-${field.id}-${opt.id}`}
                  checked={checkedValues?.has(opt.id) ?? false}
                  onCheckedChange={() => onToggleCheck(opt.id)}
                />
                <Label
                  htmlFor={`c-${field.id}-${opt.id}`}
                  className="text-sm cursor-pointer font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      );

    case AnswerType.dropdown:
      return (
        <div>
          {labelEl}
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case AnswerType.number:
      return (
        <div>
          {labelEl}
          <Input
            type="number"
            placeholder={field.placeholder || "0"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case AnswerType.date:
      return (
        <div>
          {labelEl}
          <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    case AnswerType.time:
      return (
        <div>
          {labelEl}
          <Input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    case AnswerType.datetime:
      return (
        <div>
          {labelEl}
          <Input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      );

    case AnswerType.label:
      return (
        <div className="py-1">
          <p className="text-sm text-muted-foreground">{field.label}</p>
        </div>
      );

    default:
      return (
        <div>
          {labelEl}
          <Input
            placeholder="Your answer"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

// ═══════════════════════════════════════════════════════════
// Responses Dialog — table of submissions
// ═══════════════════════════════════════════════════════════

function ResponsesDialog({
  open,
  form,
  formSummary,
  responses,
  isLoading,
  onClose,
}: {
  open: boolean;
  form: FormTemplate | null;
  formSummary: FormSummary | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Responses — {form?.name ?? formSummary?.name ?? "Loading…"}</DialogTitle>
          <DialogDescription>
            {responses.length} response{responses.length !== 1 ? "s" : ""} received
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : responses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No responses yet</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">#</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                      Responder
                    </th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Time</th>
                    {(form?.fields ?? []).map((f) => (
                      <th
                        key={f.id}
                        className="text-left py-2 px-2 font-medium text-muted-foreground max-w-[200px] truncate"
                      >
                        {f.label || "Untitled"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {responses.map((resp, ri) => {
                    const answerMap = new Map(resp.responses.map((r) => [r.fieldId, r.answer]));
                    return (
                      <tr key={resp.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 px-2 text-muted-foreground">{ri + 1}</td>
                        <td className="py-2 px-2 font-mono text-xs">{resp.pubkey.slice(0, 8)}…</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(resp.createdAt * 1000).toLocaleString()}
                        </td>
                        {(form?.fields ?? []).map((f) => {
                          const raw = answerMap.get(f.id) ?? "";
                          let display = raw;
                          // For checkboxes, show labels instead of IDs
                          if (f.type === AnswerType.checkboxes && raw) {
                            try {
                              const ids = JSON.parse(raw) as string[];
                              const optMap = new Map((f.options ?? []).map((o) => [o.id, o.label]));
                              display = ids.map((id) => optMap.get(id) ?? id).join(", ");
                            } catch {
                              /* keep raw */
                            }
                          }
                          // For radio/dropdown, show label instead of ID
                          if (
                            (f.type === AnswerType.radioButton || f.type === AnswerType.dropdown) &&
                            raw
                          ) {
                            const opt = (f.options ?? []).find((o) => o.id === raw);
                            if (opt) display = opt.label;
                          }
                          return (
                            <td key={f.id} className="py-2 px-2 max-w-[200px] truncate">
                              {display || <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="cursor-pointer">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
