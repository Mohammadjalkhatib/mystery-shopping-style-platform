---
name: geo-fixtures
description: Helpers and conventions for generating and reasoning about geographic coordinates in this repo, including haversine distance, jitter around a point, and the reference venues used in tests. Use when writing geofence maths, generating coordinate test data, or checking a distance calculation.
---

# Geo conventions

## Distance

Always haversine. Never Euclidean on raw lat/lng, it is wrong everywhere and gets worse away
from the equator. The canonical implementation lives in `apps/api/src/geo/haversine.ts` and
there is exactly one of it. Do not inline a second copy.

Earth radius: 6371000 m. Return metres, not kilometres.

## The presence rule

A fix counts as `inside` when:

```
distanceM <= venue.radiusM + min(accuracyM, ACCURACY_CAP)
```

with `ACCURACY_CAP` at 50 m. The cap bounds the tolerance; it does **not** discard the fix. A
fix reporting 400 m of accuracy still earns only 50 m, so nobody half a kilometre away appears
inside — but its position is still scored. Presence is `unknown` only when accuracy is not a
finite, non-negative number. (Until D-054 the cap was 100 m and discarded any fix above it, which
threw away a laptop's correct position along with its coarse accuracy.)

For the drift and speed checks (`jitterFingerprint`, `teleport`, `accuracyRealism`), only fixes
at `GPS_ACCURACY_M` (50 m) or better count. When writing an honest *laptop* fixture, jitter the
coordinates and vary the accuracy a little (e.g. 182-185 m): a refreshing Wi-Fi scan moves, and a
fully frozen coarse trace is modelled as a spoof (`frozenOverrideCoarseAccuracy`).

`near` is inside `radiusM + nearBufferM`. Everything else is `outside`.

## Reference points for tests

Use real Kuwait coordinates so the numbers are checkable against a map, and so the test data
looks like the product rather than like a tutorial.

| Name | Lat | Lng | Notes |
|---|---|---|---|
| `KUWAIT_CITY_CENTRE` | 29.3759 | 47.9774 | outdoor reference |
| `AVENUES_MALL` | 29.3028 | 47.9383 | indoor reference, expect degraded accuracy |
| `SALMIYA` | 29.3339 | 48.0758 | second venue, far enough to test teleports |

Distance from `KUWAIT_CITY_CENTRE` to `SALMIYA` is **10.62 km**. Use that as the known-value
assertion for the haversine test rather than inventing a synthetic pair.

> Corrected 2026-09-07. This previously said "roughly 9.6 km", which is wrong: the true
> haversine distance is 10.619 km (N-S component 4.64 km, E-W component 9.55 km at
> cos(29.35 deg)). The bad value was caught by `apps/api/src/geo/haversine.spec.ts` failing
> against a correct implementation. Recorded in `docs/AI-NOTES.md`, because a wrong number
> in a file that says "use this as the assertion" is how a correct implementation gets
> "fixed" into a broken one.

## Generating a jittered trace

Honest stationary fixes drift. When generating an honest fixture, offset each fix by a random
few metres and vary `accuracyM` between fixes. Convert metres to degrees with:

```
dLat = metres / 111320
dLng = metres / (111320 * cos(lat * pi / 180))
```

An honest trace never has two identical consecutive coordinates. A trace that does is a spoof
fixture, and that distinction is exactly what the `jitterFingerprint` signal exists to detect,
so do not blur it.
