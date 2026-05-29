import { Autocomplete, Box, TextField } from "@mui/material";
import { useMemo } from "react";

function getTimezoneList(): string[] {
  const intlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intlAny.supportedValuesOf === "function") {
    try {
      return intlAny.supportedValuesOf("timeZone");
    } catch {
      /* fall through */
    }
  }
  return [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "America/Denver",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "Europe/Madrid",
    "Europe/Amsterdam",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Dubai",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
}

interface TimezonePickerProps {
  value?: string;
  onChange: (tz: string | undefined) => void;
  placeholder?: string;
}

export function TimezonePicker({ value, onChange, placeholder }: TimezonePickerProps) {
  const zones = useMemo(getTimezoneList, []);
  const local = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  // Prepend local timezone option
  const options = useMemo(
    () => [
      { label: `Viewer's timezone (${local})`, value: "" },
      ...zones.map((tz) => ({ label: tz, value: tz })),
    ],
    [zones, local],
  );

  const selectedOption = useMemo(
    () => options.find((o) => o.value === (value || "")) || null,
    [options, value],
  );

  return (
    <Autocomplete
      size="small"
      options={options}
      getOptionLabel={(option) => option.label}
      value={selectedOption}
      onChange={(_, newValue) => onChange(newValue?.value || undefined)}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder || `Use viewer's timezone (${local})`}
          InputProps={{
            ...params.InputProps,
            sx: { fontSize: 13 },
          }}
        />
      )}
      renderOption={(props, option) => {
        // extract key from props, then delete it to avoid warnings from React
        const { key: _key, ...otherProps } = props;
        return (
          <Box component="li" key={option.value || "local"} {...otherProps} sx={{ fontSize: 13 }}>
            {option.label}
          </Box>
        );
      }}
      disableClearable={false}
      fullWidth
    />
  );
}
