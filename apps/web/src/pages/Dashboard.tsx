import { Box, CircularProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { Verdict } from '@msp/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, type ConsoleStats } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';
import { verdictChartPalette } from '../theme/theme.js';

/**
 * The overview tab.
 *
 * Two charts and a row of stat tiles, chosen against what a business user actually asks. The
 * question is not "how many visits" -- it is "which checks keep failing", which is why the
 * second chart exists and why it ranks by frequency rather than by severity.
 *
 * Rendered as inline SVG rather than with a chart library. Two reasons: every dependency here
 * needs a justification, and a charting library is a large one for two static forms; and the
 * marks a good chart needs -- 4px rounded data-ends, a 2px surface gap between stacked
 * segments, recessive axes -- are easier to control directly than to talk a library out of.
 */
export function Dashboard() {
  const t = useT();
  const [stats, setStats] = useState<ConsoleStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await api.stats(30));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !stats) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!stats) return null;

  const pct = (n: number): string =>
    stats.totals.visits === 0 ? '—' : `${Math.round((n / stats.totals.visits) * 100)}%`;

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Box>
        <Typography variant="h3" sx={{ fontSize: '1.05rem' }}>
          {t('console.dashboard.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('console.dashboard.last30', { days: stats.days })}
        </Typography>
      </Box>

      {/*
        Stat tiles, not a chart. Five single numbers have no shape to show, and a pie of three
        slices is a table with extra steps -- the percentages are already on the tiles.
      */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(5, minmax(0, 1fr))',
          },
        }}
      >
        <StatTile label={t('console.dashboard.visits')} value={String(stats.totals.visits)} />
        <StatTile
          label={t('console.dashboard.autoVerified')}
          value={pct(stats.totals.auto_verified)}
          sub={String(stats.totals.auto_verified)}
          dot={verdictChartPalette.auto_verified}
        />
        <StatTile
          label={t('console.dashboard.needsReview')}
          value={pct(stats.totals.needs_review)}
          sub={String(stats.totals.needs_review)}
          dot={verdictChartPalette.needs_review}
        />
        <StatTile
          label={t('console.dashboard.rejected')}
          value={pct(stats.totals.rejected)}
          sub={String(stats.totals.rejected)}
          dot={verdictChartPalette.rejected}
        />
        <StatTile
          label={t('console.dashboard.medianCoverage')}
          value={
            stats.medianCoverageRatio === null
              ? '—'
              : `${Math.round(stats.medianCoverageRatio * 100)}%`
          }
          sub={
            stats.medianScore === null
              ? undefined
              : `${t('console.dashboard.medianScore')} ${Math.round(stats.medianScore)}`
          }
        />
      </Box>

      {stats.totals.visits === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('console.dashboard.noData')}</Typography>
        </Paper>
      ) : (
        <>
          <ChartCard
            title={t('console.dashboard.trendTitle')}
            hint={t('console.dashboard.trendHint')}
          >
            <VerdictLegend />
            <StackedDays data={stats.byDay} />
          </ChartCard>

          <ChartCard
            title={t('console.dashboard.failuresTitle')}
            hint={t('console.dashboard.failuresHint')}
          >
            {stats.topFailingSignals.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('console.dashboard.noFailures')}
              </Typography>
            ) : (
              <FailingSignals rows={stats.topFailingSignals} />
            )}
          </ChartCard>
        </>
      )}
    </Stack>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {hint}
      </Typography>
      {children}
    </Paper>
  );
}

function StatTile({
  label,
  value,
  sub,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  dot?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.5 }}>
        {dot && (
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
        )}
        <Typography variant="caption" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Stack>
      <Typography
        sx={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

const ORDER: Verdict[] = ['auto_verified', 'needs_review', 'rejected'];

/** Identity is never colour alone: the legend is always present for more than one series. */
function VerdictLegend() {
  const t = useT();
  const label: Record<Verdict, string> = {
    auto_verified: t('console.dashboard.autoVerified'),
    needs_review: t('console.dashboard.needsReview'),
    rejected: t('console.dashboard.rejected'),
  };
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 1.5 }} useFlexGap>
      {ORDER.map((v) => (
        <Stack key={v} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box
            sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: verdictChartPalette[v] }}
          />
          <Typography variant="caption" color="text.secondary">
            {label[v]}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * One bar per day, stacked by verdict.
 *
 * A 2px gap is left between stacked segments so adjacent colours never touch — that separation
 * is what keeps the boundary readable for a colour-blind reader, and it does more work than the
 * hue difference does. Days with no visits render as an empty slot rather than being dropped,
 * because a bar chart built only from days that HAVE data compresses quiet periods and lies
 * about the shape of the series.
 */
function StackedDays({ data }: { data: ConsoleStats['byDay'] }) {
  const H = 160;
  const GAP = 2;
  const max = Math.max(1, ...data.map((d) => d.auto_verified + d.needs_review + d.rejected));
  const slot = 100 / data.length;
  const barW = Math.max(0.6, slot * 0.62);

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth: { xs: 460, sm: 0 } }}>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: H, display: 'block' }}
          role="img"
        >
          {/* Recessive baseline. No gridlines: the tooltip carries the exact numbers. */}
          <line x1="0" y1={H - 0.5} x2="100" y2={H - 0.5} stroke="rgba(0,0,0,0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const total = d.auto_verified + d.needs_review + d.rejected;
            if (total === 0) return null;
            const x = i * slot + (slot - barW) / 2;
            let y = H;
            return (
              <g key={d.date}>
                {ORDER.map((v) => {
                  const n = d[v];
                  if (n === 0) return null;
                  const h = (n / max) * (H - 8);
                  y -= h;
                  const drawH = Math.max(1, h - GAP);
                  const rect = (
                    <rect
                      key={v}
                      x={x}
                      y={y}
                      width={barW}
                      height={drawH}
                      rx="0.6"
                      fill={verdictChartPalette[v]}
                    />
                  );
                  return rect;
                })}
                <Tooltip
                  title={`${d.date} · ${total}`}
                  key={`${d.date}-hit`}
                  placement="top"
                  arrow
                >
                  {/* Hit target spans the full slot and height, never just the drawn mark. */}
                  <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
                </Tooltip>
              </g>
            );
          })}
        </svg>
        <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {data[0]?.date}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {data[data.length - 1]?.date}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * Horizontal bars, sorted worst first.
 *
 * One measure, so one hue — a categorical palette here would imply the signals are of different
 * KINDS when the only thing separating them is magnitude. Labels sit outside the bars so they
 * stay legible at every length, and every row is directly labelled because there are few enough
 * for that to help rather than clutter.
 */
function FailingSignals({ rows }: { rows: ConsoleStats['topFailingSignals'] }) {
  const t = useT();
  const max = Math.max(...rows.map((r) => r.visits), 1);

  return (
    <Stack spacing={1.25}>
      {rows.map((r) => (
        <Box key={r.code}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {r.code}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {t('console.dashboard.failuresVisits', { count: r.visits })} ·{' '}
              {t('console.dashboard.failuresPenalty', { points: r.totalPenalty })}
            </Typography>
          </Stack>
          <Tooltip title={r.reason} placement="top" arrow>
            <Box
              sx={{
                height: 10,
                borderRadius: '5px',
                bgcolor: 'action.hover',
                overflow: 'hidden',
                cursor: 'help',
              }}
            >
              <Box
                sx={{
                  width: `${(r.visits / max) * 100}%`,
                  height: '100%',
                  borderRadius: '5px',
                  bgcolor: verdictChartPalette.rejected,
                }}
              />
            </Box>
          </Tooltip>
        </Box>
      ))}
    </Stack>
  );
}
