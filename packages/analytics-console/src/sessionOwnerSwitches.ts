/**
 * Owner switches for the session page shell (d3-v2 session-original port, U15).
 *
 * Each switch is an owner item (PORT-PLAN "Owner items") where the rendered
 * mockup and prod differ. They all default to the mockup, as the 2026-10-15
 * brief asks; flip one to bring prod's behaviour back without touching the
 * layout code.
 */
export const SESSION_OWNER_SWITCHES = {
  /** Owner item 1: prod's "Synced only" filter above the stream list (mockup: off). */
  syncedOnlyFilter: false,
  /** Owner item 3: prod's pinned "Live session" row at the top of the stream list (mockup: off). */
  sidebarLiveRow: false,
  /** Owner item 2: prod's "Up to 100 recent stored streams" caption above the stream list (mockup: off). */
  streamLimitCaption: false,
  /**
   * Owner item 4 (F19): the column-fill pad (--ssp-cpad, up to 12 px inside
   * the chart card) that makes the centre column end level with the right
   * one. The mockup applies it; off, the columns end within one moment-row
   * pitch of each other.
   */
  columnFillPad: true,
  /**
   * The Moments tab's top three as a highlight reel (recap-r1 C1, Aron 2026-10-16): #1 as a large VOD
   * preview frame, #2 and #3 side by side, the rest as rows. Off: the top three are rows too (2026-10-15).
   */
  momentsReel: true,
} as const

export type SessionOwnerSwitches = typeof SESSION_OWNER_SWITCHES
