import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "./layout";

import { Skeleton } from "@/components/ui/skeleton";

const FormsPage = lazy(() => import("./pages/FormsPage").then((m) => ({ default: m.FormsPage })));
const CalendarPage = lazy(() =>
  import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const PagesPage = lazy(() => import("./pages/PagesPage").then((m) => ({ default: m.PagesPage })));
const DrivePage = lazy(() => import("./pages/DrivePage").then((m) => ({ default: m.DrivePage })));
const PollsPage = lazy(() => import("./pages/PollsPage").then((m) => ({ default: m.PollsPage })));

function RouteFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
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
