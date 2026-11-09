import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import { logAudit } from '../audit/audit.service';
import { getFeedStatus, rewindFeed, startFeed, stopFeed } from './socialFeed';

export const feedsRouter = Router();

feedsRouter.use(requireRole('commander', 'admin'));

/** GET /api/feeds/social  -> is the mock feed running, how many posts sent */
feedsRouter.get('/social', (_req, res) => {
  res.json({ status: getFeedStatus() });
});

/** POST /api/feeds/social/start | stop | rewind */
const actions = { start: startFeed, stop: stopFeed, rewind: rewindFeed };

for (const [name, action] of Object.entries(actions)) {
  feedsRouter.post(`/social/${name}`, async (req, res) => {
    const status = action();
    await logAudit({
      actorType: 'human',
      actorName: req.user!.name,
      action: `feed.${name}`,
      summary: `${name === 'start' ? 'Started' : name === 'stop' ? 'Stopped' : 'Rewound'} the social media feed.`,
    });
    res.json({ status });
  });
}
