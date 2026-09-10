// `HelpOutlined`, not `HelpOutline` -- v9 dropped the bare alias that v5 shipped.
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { Box, Stack, Typography } from '@mui/material';
import type { Presence } from '@msp/shared';
import { useT } from '../i18n/LocaleContext.js';
import { qa, verdictPalette } from '../theme/theme.js';

/**
 * Where the participant is, said out loud while there is still time to do something about it.
 *
 * This is the "live presence indicator" `docs/BACKLOG.md` asked for in `feat/participant-flow`
 * and never got, and its absence was a real product failure: the server computed presence on
 * the very first fix, and the participant found out days later from a rejection. Someone could
 * stand in the wrong branch of a chain for an hour with the system knowing the whole time.
 *
 * **The state is computed on the server and relayed, never computed here** (rule 2, rule 7).
 * The classification is the server's: it holds the snapshot the visit is judged against and
 * applies `presenceFor` to it, and no arithmetic on the fence happens in the browser.
 *
 * **It says which state, never how far** (D-036), and the honest reason is narrower than it
 * first looks. A metre readout would be a live oracle — move, read, adjust — but the fence it
 * would reveal is ALREADY disclosed: `GET /sessions/:id` returns `venue.lat`, `venue.lng` and
 * `venue.radiusM` to the participant, and this screen renders the radius on the ready-to-start
 * card. So withholding distance here buys only `nearBufferM`, which an attacker aiming to look
 * *inside* never needs. It is kept withheld because it costs nothing to withhold, not because
 * it is load-bearing; the disclosure worth revisiting is `SessionView`, and that is recorded
 * rather than changed here. The `spoof-adversary` pass established this, against the opposite
 * claim that used to be written in this comment.
 *
 * Two states here are deliberately NOT failures, and the copy says so in both:
 * `unknown` is an accuracy problem, normal indoors, and the engine is already told not to
 * punish it; and `null` means no answer has come back yet, which lasts up to a sampling
 * interval at the start of every visit and is not the same claim as "you are not there".
 */
export function PresenceBanner({
  presence,
  presenceAt,
  venueName,
}: {
  presence: Presence | null;
  /** Device clock of the fix behind the answer. Used only to show an age. */
  presenceAt: number | null;
  venueName: string;
}) {
  const t = useT();

  /**
   * Each state's colour, ground and mark.
   *
   * This used to be four MUI `Alert` severities. An `Alert` is the right weight for a passing
   * remark and the wrong weight for the single most important fact on the screen — it rendered
   * at the same size as the offline notice and the background-tab notice stacked beneath it,
   * and it was the only one of the three that changes what the participant should DO.
   *
   * The colours are the brand's, not MUI's semantic set, and `inside` is deliberately the brand
   * teal rather than a success green. This screen belongs to the same system as the verdict
   * that comes out of it, and a green tick here promises a certainty the engine will not
   * deliver later (D-001).
   */
  const view = {
    outside: {
      colour: verdictPalette.rejected.main,
      ground: qa.red[50],
      title: 'participant.presence.outside',
      hint: 'participant.presence.outsideHint',
      mark: 'alert',
    },
    near: {
      colour: verdictPalette.needs_review.main,
      ground: qa.yellow[50],
      title: 'participant.presence.near',
      hint: 'participant.presence.nearHint',
      mark: 'pin',
    },
    inside: {
      colour: qa.teal[700],
      ground: qa.teal[50],
      title: 'participant.presence.inside',
      hint: 'participant.presence.insideHint',
      mark: 'pin',
    },
    unknown: {
      colour: qa.neutral[600],
      ground: qa.neutral[100],
      title: 'participant.presence.unknown',
      hint: 'participant.presence.unknownHint',
      mark: 'question',
    },
  } as const;

  const v = presence
    ? view[presence]
    : ({
        colour: qa.neutral[600],
        ground: qa.neutral[100],
        title: 'participant.presence.checking',
        hint: 'participant.presence.checkingHint',
        mark: 'question',
      } as const);

  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: 'center',
        textAlign: 'center',
        px: 2.5,
        py: 3,
        mb: 2,
        bgcolor: v.ground,
        border: `1px solid ${v.colour}22`,
        borderRadius: `${qa.radius.xl}px`,
      }}
    >
      <Box
        sx={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: `${v.colour}1f`,
          flexShrink: 0,
        }}
      >
        <PresenceMark mark={v.mark} colour={v.colour} />
      </Box>

      {/*
        The venue is named in the headline rather than left to context. A participant with more
        than one visit open, reading a phone one-handed in a shop, should not have to work out
        which one this is about.
      */}
      <Box>
        <Typography variant="h2" sx={{ fontSize: '1.25rem', mb: 0.5 }}>
          {t(v.title, { venue: venueName })}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>
          {t(v.hint)}
        </Typography>
      </Box>

      {/*
        The age, once the answer is old enough to doubt. Presence only moves when a batch
        reaches the server, so an offline participant keeps seeing the last answer — saying how
        old it is turns a stale reading into an honest one rather than a wrong one.
      */}
      {presenceAt !== null && <Freshness at={presenceAt} />}
    </Stack>
  );
}

/**
 * The mark inside the disc.
 *
 * These are `@mui/icons-material`, which is already a dependency and already used by
 * `ParticipantApp`, `NotificationBell` and `History`. An earlier version of this file drew them
 * by hand on the stated grounds that the app had no icon dependency, which was simply false —
 * see `docs/AI-NOTES.md`, 2026-09-11, and D-045.
 *
 * Outlined variants, to sit with the outlined set the bottom navigation already uses. Colour and
 * size come from the caller so the mark stays tied to the state rather than to this component.
 */
function PresenceMark({ mark, colour }: { mark: 'pin' | 'alert' | 'question'; colour: string }) {
  const sx = { fontSize: 30, color: colour } as const;

  if (mark === 'pin') return <PlaceOutlinedIcon sx={sx} aria-hidden />;
  if (mark === 'alert') return <WarningAmberOutlinedIcon sx={sx} aria-hidden />;
  return <HelpOutlinedIcon sx={sx} aria-hidden />;
}

function Freshness({ at }: { at: number }) {
  const t = useT();
  const mins = Math.floor((Date.now() - at) / 60_000);
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
      {mins < 1 ? t('participant.presence.staleNow') : t('participant.presence.stale', { mins })}
    </Typography>
  );
}
