import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import DashboardHome from "../src/routes/dashboard/Home";
import AnalyticsLandingPage from "../src/routes/analytics/AnalyticsLandingPage";

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
      activity: { points: [], windowMinutes: 7 * 24 * 60, channelCount: 0 },
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
    loadSource: "full",
    hubEndpointOk: true,
    liveEmpty: true,
    lastUpdated: Date.now(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/hooks/useHubRecentLogins", () => ({
  useHubRecentLogins: () => [],
}));

describe("/analytics landing (AnalyticsLandingPage)", () => {
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
});

describe("/analytics hub (DashboardHome at /analytics/hub)", () => {
  it("renders the aggregate analytics hub when public hub data is empty", async () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Stream intelligence/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("main", { name: /StreamPulse analytics hub/i }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Emote signal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /24h/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /7d/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /1mo/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /1 year/i })).toBeTruthy();
    expect(
      screen.getByText(/Imported VOD sessions never fill this global graph/i),
    ).toBeTruthy();
    expect(screen.getByText(/DonkPls/i)).toBeTruthy();
    expect(screen.getAllByText(/no rollup/i).length).toBeGreaterThan(0);
    expect(document.querySelector(".hubx")).toBeTruthy();
    expect(document.querySelector(".figma-analytics")).toBeNull();
  });
});
