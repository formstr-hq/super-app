import { Box } from "@mui/material";

import type { FormField } from "../../services/forms/types";

import { FieldInput } from "./FieldInput";

interface Props {
  fields: FormField[];
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}

export function FormFieldsRenderer({ fields, values, onChange }: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          onChange={(val) => onChange(field.id, val)}
        />
      ))}
    </Box>
  );
}
