import { Box, Button, Chip, IconButton, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check, Eye, EyeOff, Loader2, Plug, X } from "lucide-react";
import { useState } from "react";

import { createProvider } from "../../ai";
import {
  AI_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_LABELS,
  isCloudProvider,
} from "../../lib/aiProviders";
import { useSettingsStore, type AIProviderType } from "../../stores/settingsStore";

type TestStatus = "idle" | "testing" | "ok" | "error";
interface TestState {
  status: TestStatus;
  message?: string;
  models?: string[];
}

const STATUS_COLOR: Record<TestStatus, string> = {
  idle: "#9ca3af",
  testing: "#eab308",
  ok: "#22c55e",
  error: "#ef4444",
};

export function AISettingsSection() {
  const settings = useSettingsStore();
  const [tab, setTab] = useState<AIProviderType>(settings.aiProvider);
  const [tests, setTests] = useState<Partial<Record<AIProviderType, TestState>>>({});
  const [showKey, setShowKey] = useState(false);
  const theme = useTheme();

  const active = settings.aiProvider;
  const provider = tab;
  const test = tests[provider] ?? { status: "idle" as TestStatus };
  const model = settings.aiModels[provider] ?? "";

  async function runTest() {
    setTests((t) => ({ ...t, [provider]: { status: "testing" } }));
    try {
      const p = createProvider({
        aiProvider: provider,
        apiKeys: settings.apiKeys,
        ollamaUrl: settings.ollamaUrl,
        compatBaseUrl: settings.compatBaseUrl,
        compatKey: settings.compatKey,
      });
      if (!(await p.isAvailable())) {
        setTests((t) => ({
          ...t,
          [provider]: { status: "error", message: "Not configured or unreachable." },
        }));
        return;
      }
      const models = await p.getAvailableModels();
      setTests((t) => ({
        ...t,
        [provider]: { status: "ok", models, message: `Connected · ${models.length} models` },
      }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [provider]: { status: "error", message: e instanceof Error ? e.message : "Failed." },
      }));
    }
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
        AI &amp; Models
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        Bring your own API keys. Keys are stored locally in your browser (localStorage) on this
        device only — they never leave it except in direct calls to the provider you choose.
      </Typography>

      <Tabs
        value={provider}
        onChange={(_, v) => {
          setTab(v as AIProviderType);
          setShowKey(false);
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, mb: 2, borderBottom: `1px solid ${theme.palette.divider}` }}
      >
        {AI_PROVIDERS.map((p) => (
          <Tab
            key={p}
            value={p}
            sx={{ minHeight: 40, textTransform: "none", fontSize: 13 }}
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                {PROVIDER_LABELS[p]}
                {active === p && (
                  <Box
                    component="span"
                    sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "#22c55e" }}
                  />
                )}
              </Box>
            }
          />
        ))}
      </Tabs>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560 }}>
        {/* Header row: active state + set-active */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {PROVIDER_LABELS[provider]}
            {active === provider && (
              <Typography component="span" variant="caption" sx={{ ml: 1, color: "#22c55e" }}>
                Active
              </Typography>
            )}
          </Typography>
          <Button
            size="small"
            variant={active === provider ? "outlined" : "contained"}
            disabled={active === provider}
            startIcon={<Check size={14} />}
            onClick={() => settings.setActiveProvider(provider)}
            sx={{ textTransform: "none" }}
          >
            {active === provider ? "Active" : "Set as active"}
          </Button>
        </Box>

        {/* Credential / endpoint */}
        {isCloudProvider(provider) && (
          <TextField
            label="API key"
            size="small"
            fullWidth
            type={showKey ? "text" : "password"}
            value={settings.apiKeys[provider] ?? ""}
            onChange={(e) => settings.setApiKey(provider, e.target.value || null)}
            placeholder={`Paste your ${PROVIDER_LABELS[provider]} API key`}
            InputProps={{
              endAdornment: (
                <Box sx={{ display: "flex" }}>
                  <IconButton
                    size="small"
                    onClick={() => setShowKey((s) => !s)}
                    title="Show / hide"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </IconButton>
                  {settings.apiKeys[provider] && (
                    <IconButton
                      size="small"
                      onClick={() => settings.setApiKey(provider, null)}
                      title="Clear"
                    >
                      <X size={15} />
                    </IconButton>
                  )}
                </Box>
              ),
            }}
          />
        )}

        {provider === "ollama" && (
          <TextField
            label="Ollama endpoint"
            size="small"
            fullWidth
            value={settings.ollamaUrl}
            onChange={(e) => settings.setOllamaUrl(e.target.value)}
            placeholder="http://localhost:11434"
          />
        )}

        {provider === "openai-compat" && (
          <>
            <TextField
              label="Base URL"
              size="small"
              fullWidth
              value={settings.compatBaseUrl}
              onChange={(e) => settings.setCompatConfig({ baseUrl: e.target.value })}
              placeholder="http://localhost:1234/v1"
              helperText="OpenAI-compatible endpoint (LM Studio, llama.cpp, vLLM, OpenRouter…)"
            />
            <TextField
              label="API key (optional)"
              size="small"
              fullWidth
              type={showKey ? "text" : "password"}
              value={settings.compatKey ?? ""}
              onChange={(e) => settings.setCompatConfig({ key: e.target.value || null })}
              InputProps={{
                endAdornment: (
                  <IconButton
                    size="small"
                    onClick={() => setShowKey((s) => !s)}
                    title="Show / hide"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </IconButton>
                ),
              }}
            />
          </>
        )}

        {/* Model */}
        <TextField
          label="Model"
          size="small"
          fullWidth
          value={model}
          onChange={(e) => settings.setProviderModel(provider, e.target.value || null)}
          placeholder={PROVIDER_DEFAULT_MODEL[provider]}
          helperText={`Default: ${PROVIDER_DEFAULT_MODEL[provider]}`}
        />

        {test.models && test.models.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {test.models.slice(0, 24).map((m) => (
              <Chip
                key={m}
                label={m}
                size="small"
                variant={m === model ? "filled" : "outlined"}
                onClick={() => settings.setProviderModel(provider, m)}
                sx={{ fontSize: 11, cursor: "pointer" }}
              />
            ))}
          </Box>
        )}

        {/* Test connection */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={
              test.status === "testing" ? (
                <Loader2 size={14} style={{ animation: "spin 0.6s linear infinite" }} />
              ) : (
                <Plug size={14} />
              )
            }
            disabled={test.status === "testing"}
            onClick={runTest}
            sx={{ textTransform: "none" }}
          >
            Test connection
          </Button>
          {test.message && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: STATUS_COLOR[test.status],
                }}
              />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {test.message}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
