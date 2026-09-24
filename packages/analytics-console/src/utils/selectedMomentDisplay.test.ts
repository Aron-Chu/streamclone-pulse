import { describe, expect, it } from "vitest";
import { buildSelectedMomentDisplay } from "./selectedMomentDisplay.ts";

describe("buildSelectedMomentDisplay", () => {
  it("builds a validated VOD link from the stream-relative rollup offset", () => {
    const display = buildSelectedMomentDisplay({
      rollup: {
        minuteTs: "2026-07-13T18:04:00Z",
        chatCount: 20,
        totalEmoteCount: 5,
      },
      rollups: [
        {
          minuteTs: "2026-07-13T18:04:00Z",
          chatCount: 20,
          totalEmoteCount: 5,
        },
      ],
      startedAt: "2026-07-13T18:00:00Z",
      vodAlignSeconds: 0,
      vodLinkState: {
        status: "linked",
        vodId: "2834270468",
        label: "Jump to VOD",
        detail: "",
      },
    });

    expect(display.offsetSeconds).toBe(240);
    expect(display.vodUrl).toBe(
      "https://www.twitch.tv/videos/2834270468?t=4m0s",
    );
    expect(display.vodJumpOffsetStr).toBe("4m0s");
  });

  it("SelectedMomentDisplaySeparatesClockFromVodSeek", () => {
    const display = buildSelectedMomentDisplay({
      rollup: {
        minuteTs: "2026-07-13T18:10:00Z",
        chatCount: 20,
        totalEmoteCount: 5,
      },
      rollups: [
        {
          minuteTs: "2026-07-13T18:10:00Z",
          chatCount: 20,
          totalEmoteCount: 5,
        },
      ],
      startedAt: "2026-07-13T18:00:00Z",
      vodAlignSeconds: 0,
      recapMoment: {
        offsetSeconds: 600,
        reactionOnsetOffsetSeconds: 608,
        seekOffsetSeconds: 605,
        reactionApexOffsetSeconds: 610,
        precisionSeconds: 1,
        refinementStatus: "refined",
        score: 90,
        reasons: ["chat_spike"],
      },
      vodLinkState: {
        status: "linked",
        vodId: "2834270468",
        label: "Jump to VOD",
        detail: "",
      },
    });

    expect(display.offsetSeconds).toBe(608);
    expect(display.analyticalOffsetSeconds).toBe(608);
    expect(display.seekOffsetSeconds).toBe(605);
    expect(display.offsetStr).toBe("10m8s");
    expect(display.vodUrl).toBe(
      "https://www.twitch.tv/videos/2834270468?t=10m5s",
    );
    expect(display.vodJumpOffsetStr).toBe("10m5s");
  });

  it("does not label a VOD jump when alignment is unavailable", () => {
    const display = buildSelectedMomentDisplay({
      rollup: {
        minuteTs: "2026-07-13T18:10:00Z",
        chatCount: 20,
        totalEmoteCount: 5,
      },
      rollups: [],
      startedAt: "2026-07-13T18:00:00Z",
      vodLinkState: {
        status: "linked",
        vodId: "2834270468",
        label: "Jump to VOD",
        detail: "",
      },
    });

    expect(display.offsetStr).toBe("10m0s");
    expect(display.vodUrl).toBe("https://www.twitch.tv/videos/2834270468");
    expect(display.vodJumpOffsetStr).toBeUndefined();
  });
});
