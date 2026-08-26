/**
 * Unit coverage for analytics landing / hub render paths.
 *
 * Known debt: the stats-fallback case can OOM or hang under full vitest runs (~50 min observed).
 * Until the render memory issue is isolated, treat e2e
 * `tests/e2e/analytics-hub-metrics-honesty.spec.ts` as authority for stats-fallback honesty.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardHome from "../src/routes/dashboard/Home";
import AnalyticsLandingPage from "../src/routes/analytics/AnalyticsLandingPage";

const hubMockOpts = vi.hoisted(() => ({
  loadSource: "full" as "full" | "stats-fallback" | "cache",
  hubEndpointOk: true,
  activityFallback: false,
}));

vi.mock("../src/hooks/usePublicHubData", () => ({
  usePublicHubData: () => ({
    data: {
      generatedAt: new Date().toISOString(),
      poolSize: 0,
      corpus: {
        streamsTracked: 6800,
        momentsDetected: 0,
        chatMessagesProcessed: 10700000,
        emotesIndexed: 10700000,
        vodsAnalyzed: 709,
      },
      coverage: {
        liveChannels: 0,
        trackingMax: 100,
        backfillActive: 0,
        backfillMax: 4,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: "operational",
      },
      corpusPipeline: {
        generatedAt: new Date().toISOString(),
        state: "healthy",
        topN: 500,
        collectorActive: 3,
        collectorMax: 10,
        roster: {
          live: 0,
          collectorTracking: 0,
          expectedCollectorRows: 0,
          liveCollectorDeficitRows: 0,
          metadataOnly: 0,
          metadataStale: 0,
          admissionDisabled: 0,
          capacityBlocked: 0,
          warming: 0,
          collecting: 0,
          viewerOnly: 0,
          zeroChatAfterAge: 0,
        },
      },
      activity: hubMockOpts.activityFallback
        ? {
            points: [
              {
                t: Date.now() - 60_000,
                chat: 10,
                seventv: 2,
                emotes: 4,
                viewers: 100,
                bucketComplete: true,
              },
            ],
            windowMinutes: 24 * 60,
            requestedWindowMinutes: 24 * 60,
            availableWindowMinutes: 30,
            servedWindowMinutes: 30,
            bucketMinutes: 1,
            source: "live_pool_fallback",
            state: "degraded",
            reason: "historical_projection_unavailable",
            channelCount: 3,
          }
        : { points: [], windowMinutes: 7 * 24 * 60, channelCount: 0 },
      emoteIntel: {
        emotesPerMin: 0,
        topEmoteSharePct: 0,
        uniqueEmotes: 0,
        biggestPeakPerMin: 0,
        seventvSharePct: 0,
        providerShares: [],
      },
      topEmotes: [],
      topMovers: [
        {
          login: "xqc",
          displayName: "xQc",
          viewers: 24000,
          emotesPerMin: 400,
          seventvPerMin: 380,
          chatPerMin: 500,
          trendPct: -10,
        },
      ],
      liveChannels: [
        {
          login: "sodapoppin",
          displayName: "sodapoppin",
          category: "Just Chatting",
          viewers: 8853,
          chatPerMin: 132,
          emotesPerMin: 82,
          seventvPerMin: 66,
          coverageState: "synced",
          trendPct: -34,
          profileImageUrl: "https://cdn.example/soda.png",
        },
        {
          login: "xqc",
          displayName: "xQc",
          category: "Just Chatting",
          viewers: 24000,
          chatPerMin: 500,
          emotesPerMin: 400,
          seventvPerMin: 380,
          coverageState: "synced",
          trendPct: -10,
          profileImageUrl: "https://cdn.example/xqc.png",
        },
        {
          login: "eliasn97",
          displayName: "eliasn97",
          category: "IRL",
          viewers: 41556,
          chatPerMin: 0,
          emotesPerMin: 0,
          seventvPerMin: 0,
          coverageState: "viewer_only",
          trendPct: 0,
        },
      ],
      moments: [
        {
          kind: "emote_spike",
          login: "sodapoppin",
          displayName: "sodapoppin",
          streamId: "fixture-stream",
          label: "sodapoppin emote spam spike",
          detail: "Just Chatting",
          magnitude: 64,
          at: Date.now(),
          topEmotes: [
            { name: "DonkPls", provider: "7TV", count: 320, sharePct: 42 },
          ],
        },
      ],
      livePulseMoments: [],
      featuredSession: { state: "empty", reason: "no_qualifying_session" },
    },
    loading: false,
    refreshing: false,
    error: null,
    loadSource: hubMockOpts.loadSource,
    hubEndpointOk: hubMockOpts.hubEndpointOk,
    liveEmpty: true,
    lastUpdated: Date.now(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/hooks/useHubRecentLogins", () => ({
  useHubRecentLogins: () => [],
}));

describe("/analytics landing (AnalyticsLandingPage)", () => {
  afterEach(() => {
    hubMockOpts.loadSource = "full";
    hubMockOpts.hubEndpointOk = true;
    hubMockOpts.activityFallback = false;
  });

  it("renders Pulse Moments Live without the removed Moments feed", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: /Pulse Moments/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Moments feed/i })).toBeNull();
  });

  it("renders Live Activity before Pulse Moments in the page flow", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    const liveActivity = await screen.findByRole("region", { name: /Live Activity/i });
    const pulseMoments = await screen.findByRole("heading", { name: /Pulse Moments/i });
    const activityHub = document.querySelector(".figma-activity-hub");

    const position = liveActivity.compareDocumentPosition(pulseMoments);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(activityHub).toBeTruthy();
    expect(activityHub?.contains(liveActivity)).toBe(true);
    expect(activityHub?.contains(pulseMoments)).toBe(true);
  });

  it("exposes the served window when the activity payload has no measured buckets", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    const liveActivity = await screen.findByRole("region", { name: /Live Activity/i });
    expect(liveActivity.getAttribute("data-hub-activity-state")).toBe("unmeasured");
    expect(liveActivity.getAttribute("data-hub-requested-window-minutes")).toBe("1440");
    expect(liveActivity.getAttribute("data-hub-served-window-minutes")).toBe("30");
    expect(screen.getByTestId("hub-activity-served-window").textContent).toContain(
      "Showing served 30 minutes.",
    );
  });

  it("labels a degraded range as requested versus available", async () => {
    hubMockOpts.activityFallback = true;
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: /Live Activity/i });
    expect(screen.getByText("24h · 30m available")).toBeTruthy();
    expect(screen.getByTestId("hub-activity-served-window").textContent).toContain(
      "1 day requested · 30 minutes available",
    );
  });

  it("keeps selected long-range copy tied to the active request during stale fallback display", async () => {
    hubMockOpts.activityFallback = true;
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: /Live Activity/i });
    screen.getByRole("button", { name: /Activity time window:/i }).click();
    screen.getByRole("option", { name: /7d/ }).click();

    expect(screen.getByRole("button", { name: /Activity time window: 7d requested/i })).toBeTruthy();
    expect(screen.getByTestId("hub-activity-served-window").textContent).toContain(
      "7 days requested · 30 minutes available",
    );
  });

  it("does not infer that longer projections are unavailable from a healthy current range", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    await screen.findByRole("region", { name: /Live Activity/i });
    screen.getByRole("button", { name: /Activity time window:/i }).click();
    const sevenDay = screen.getByRole("option", { name: /^7d$/ });
    expect(sevenDay.textContent).toBe("7d");
    expect(sevenDay.textContent).not.toMatch(/available/i);
  });

  it("uses the aggregate activity chart instead of the duplicate featured session block", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("region", { name: /Live Activity/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: /Featured session analytics/i }),
    ).toBeNull();
  });

  it("keeps a single primary channel search on the analytics landing", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("search", { name: /Channel search/i }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("search", { name: /Channel search/i }),
    ).toHaveLength(1);
    expect(document.querySelector(".figma-analytics__toolbar")).toBeNull();
    expect(document.querySelector(".figma-analytics__live-pill")).toBeNull();
  });

  it("renders top mover avatars from live channel profile images", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Emote signal/i });
    const moverRow = document.querySelector(".hx-mover");
    expect(moverRow?.querySelector("img")?.getAttribute("src")).toContain(
      "cdn.example/xqc.png",
    );
  });

  it("does not expose hosted API hostname on the public landing", async () => {
    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: /Command center/i });
    expect(screen.queryByText(/Reading Hosted API/i)).toBeNull();
    expect(screen.queryByText(/api\.streampulse\.stream/i)).toBeNull();
    expect(
      screen.queryByText(/Imported VOD sessions never fill this global graph/i),
    ).toBeNull();
  });

  it("shows degraded hub copy and static Live Wire on stats-fallback", async () => {
    hubMockOpts.loadSource = "stats-fallback";
    hubMockOpts.hubEndpointOk = false;

    render(
      <MemoryRouter>
        <AnalyticsLandingPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/Hub temporarily unavailable/i),
    ).toBeTruthy();
    expect(screen.getAllByText(/hub unavailable — live network feed paused/i).length).toBe(1);
    expect(screen.queryByText("NEW")).toBeNull();
  });
});

describe("/analytics hub (DashboardHome quarantine)", () => {
  it("renders private workspace landing, not the public analytics hub", async () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /StreamPulse workspace/i,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /\/analytics/i })).toBeTruthy();
    expect(screen.queryByRole("main", { name: /StreamPulse analytics hub/i })).toBeNull();
    expect(
      screen.queryByText(/Imported VOD sessions never fill this global graph/i),
    ).toBeNull();
  });
});
