import { Box, Button, Chip, InputBase, Typography } from "@mui/material";
import { Search, X } from "lucide-react";

import { isFilterActive, type CardFilter } from "../../kanban/cardFilter";

/** Labels beyond this stay out of the toolbar; the search box still finds them. */
const MAX_LABEL_CHIPS = 6;

interface BoardToolbarProps {
  filter: CardFilter;
  onChange: (next: CardFilter) => void;
  /** Board labels, most-used first. */
  labels: string[];
  /** False when signed out — there is no "me" to filter by. */
  canFilterMine: boolean;
  matchCount: number;
  totalCount: number;
}

export function BoardToolbar({
  filter,
  onChange,
  labels,
  canFilterMine,
  matchCount,
  totalCount,
}: BoardToolbarProps) {
  const active = isFilterActive(filter);

  const toggleLabel = (label: string) => {
    const next = filter.labels.includes(label)
      ? filter.labels.filter((l) => l !== label)
      : [...filter.labels, label];
    onChange({ ...filter, labels: next });
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 0.75,
        borderBottom: 1,
        borderColor: "divider",
        overflowX: "auto",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          height: 28,
          width: 180,
          flexShrink: 0,
          px: 1,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          color: "text.secondary",
        }}
      >
        <Search size={13} />
        <InputBase
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder="Search cards"
          inputProps={{ "aria-label": "Search cards" }}
          sx={{ fontSize: 13, flex: 1, "& input": { p: 0 } }}
        />
      </Box>

      {canFilterMine && (
        <FilterChip
          label="Assigned to me"
          selected={filter.assignedToMe}
          onClick={() => onChange({ ...filter, assignedToMe: !filter.assignedToMe })}
        />
      )}
      <FilterChip
        label="Unassigned"
        selected={filter.unassigned}
        onClick={() => onChange({ ...filter, unassigned: !filter.unassigned })}
      />

      {labels.slice(0, MAX_LABEL_CHIPS).map((label) => (
        <FilterChip
          key={label}
          label={label}
          selected={filter.labels.includes(label)}
          onClick={() => toggleLabel(label)}
        />
      ))}

      <Box sx={{ flex: 1, minWidth: 8 }} />

      {active && (
        <>
          <Typography variant="caption" color="text.secondary" noWrap>
            {matchCount} of {totalCount}
          </Typography>
          <Button
            size="small"
            startIcon={<X size={12} />}
            onClick={() =>
              onChange({ query: "", assignedToMe: false, unassigned: false, labels: [] })
            }
            sx={{ flexShrink: 0, color: "text.secondary", minWidth: 0 }}
          >
            Clear
          </Button>
        </>
      )}
    </Box>
  );
}

interface FilterChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

function FilterChip({ label, selected, onClick }: FilterChipProps) {
  return (
    <Chip
      label={label}
      size="small"
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        height: 24,
        borderRadius: 1,
        flexShrink: 0,
        fontSize: 12,
        border: 1,
        borderColor: selected ? "var(--fs-accent-line)" : "divider",
        bgcolor: selected ? "var(--fs-accent-tint)" : "transparent",
        color: selected ? "var(--fs-accent)" : "text.secondary",
        "&:hover": { bgcolor: selected ? "var(--fs-accent-tint)" : "var(--fs-accent-wash)" },
      }}
    />
  );
}
