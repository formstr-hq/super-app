import { Box } from "@mui/material";

import type { FormField } from "../../services/forms/types";

import { FieldInput } from "./FieldInput";

interface Props {
  fields: FormField[];
  values: Record<string, string>;
  checkAnswers?: Record<string, Set<string>>;
  onChange: (fieldId: string, value: string) => void;
  onToggleCheck?: (fieldId: string, optionId: string) => void;
}

export function FormFieldsRenderer({
  fields,
  values,
  checkAnswers,
  onChange,
  onToggleCheck,
}: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          checkedValues={checkAnswers?.[field.id]}
          onChange={(val) => onChange(field.id, val)}
          onToggleCheck={(optId) => onToggleCheck?.(field.id, optId)}
        />
      ))}
    </Box>
  );
}
