import { Box, Skeleton } from "@mui/material";
import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "./layout";
import { FillPage } from "./pages/FillPage";

const FormsPage = lazy(() => import("./pages/FormsPage").then((m) => ({ default: m.FormsPage })));
const CalendarPage = lazy(() =>
  import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const PagesPage = lazy(() => import("./pages/PagesPage").then((m) => ({ default: m.PagesPage })));
const DrivePage = lazy(() => import("./pages/DrivePage").then((m) => ({ default: m.DrivePage })));
const PollsPage = lazy(() => import("./pages/PollsPage").then((m) => ({ default: m.PollsPage })));

function RouteFallback() {
  return (
    <Box
      sx={{
        maxWidth: "lg",
        mx: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        px: 2,
        py: 3,
        width: "100%",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton variant="rectangular" height={28} width={160} sx={{ borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={36} width={100} sx={{ borderRadius: 1 }} />
      </Box>
      <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
        <Skeleton variant="rectangular" height={160} sx={{ flex: 1, borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={160} sx={{ flex: 1, borderRadius: 2 }} />
        <Skeleton
          variant="rectangular"
          height={160}
          sx={{ flex: 1, borderRadius: 2, display: { xs: "none", md: "block" } }}
        />
      </Box>
    </Box>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/forms/fill/:naddr", element: <FillPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/forms" replace /> },
      {
        path: "forms/*",
        element: (
          <LazyRoute>
            <FormsPage />
          </LazyRoute>
        ),
      },
      {
        path: "calendar/*",
        element: (
          <LazyRoute>
            <CalendarPage />
          </LazyRoute>
        ),
      },
      {
        path: "pages/*",
        element: (
          <LazyRoute>
            <PagesPage />
          </LazyRoute>
        ),
      },
      {
        path: "drive/*",
        element: (
          <LazyRoute>
            <DrivePage />
          </LazyRoute>
        ),
      },
      {
        path: "polls/*",
        element: (
          <LazyRoute>
            <PollsPage />
          </LazyRoute>
        ),
      },
    ],
  },
]);
