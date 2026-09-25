# Global Moment History

History shows only verified retained UTC dates from indexed, completed public
IRC broadcasts. It opens on the most recent certified range, at most 30 days.
Selecting a day narrows the ranking; creator and category filters are optional.
Legacy `creator` parameters alone do not scope History; an explicit creator
filter adds `scope=creator`. Older year and month links explain the available
range instead of implying a durable year archive.

## Ranking and calendar contract

- Explore and History request `sort=volume` from
  `/v1/public/discovery/ranked`. The score is observed IRC chat messages in a
  detected moment's minute. It ranks detector-selected moments among indexed
  completed broadcasts; it does not enumerate every busy minute or stream.
- Relative `sort=top` remains hidden and server-gated until cross-stream score
  calibration has representative production evidence.
- `/v1/public/discovery/ranked/availability` establishes the server's UTC date,
  exclusive certified end, verified lower bound, certificate generation, and
  daily measurement cells. History's compact heatmap uses these cells, not the
  legacy unranked month or year activity endpoint. The ranking response must
  carry matching bounds and generation before the calendar is shown.
- The date window is inclusive in the UI and exclusive at the API end. The
  open UTC day belongs in Latest. A custom Explore range can cover at most 30
  certified days. Pagination stays bound to its certificate generation and
  first-page snapshot.
- A measured day has partial coverage of the indexed corpus. A day with no
  indexed measurement is distinct from a measured day with zero detections.
  An expired, revoked, or unavailable certificate hides the calendar and
  ranking rather than showing a quiet day.

## Verification and release status

The backend's prospective capture begins with migration 100022. Its first
certifiable day starts two UTC dates after that migration's capture timestamp,
and broadcasts that began before that boundary stay outside the ranked
corpus. A completed-broadcast source correction, loss, direct derived edit,
or scoring-config change must revoke or fail the certificate until reprojection
and verification succeed. These limits make History a recent indexed view,
not a promise of year-long retention.

Local browser fixtures verify date clipping, calendar/ranking agreement,
creator scope, pagination, error states, and narrow/desktop layouts. They are
not hosted-data evidence. The hosted ranked endpoint still returned 404 at the
September 23 audit; no production activation or populated History is implied
by the local candidate. Keep the separate Pulse Explorer route until a working
replacement has been demonstrated.
