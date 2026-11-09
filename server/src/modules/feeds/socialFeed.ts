import { env } from '../../config/env';
import { PLACES } from '../../data/chennaiPlaces';
import { SOCIAL_POSTS } from '../../data/socialPosts';
import { broadcast } from '../../realtime/socket';
import { logger } from '../../utils/logger';
import { ingestReport } from '../reports/reports.service';

/**
 * MOCK SOCIAL-MEDIA FEED (SRS 4.1)
 * Replays the synthetic posts one by one, every few seconds, through the
 * same ingestion pipeline as real reports. The commander starts and stops
 * it from the dashboard to simulate a burst of incoming reports.
 */

let timer: NodeJS.Timeout | null = null;
let nextIndex = 0;

export interface FeedStatus {
  running: boolean;
  posted: number;
  total: number;
  intervalSeconds: number;
}

export function getFeedStatus(): FeedStatus {
  return {
    running: timer !== null,
    posted: nextIndex,
    total: SOCIAL_POSTS.length,
    intervalSeconds: env.SOCIAL_FEED_INTERVAL_SECONDS,
  };
}

function publishStatus() {
  broadcast('feed:status', getFeedStatus());
}

async function postNext() {
  if (nextIndex >= SOCIAL_POSTS.length) {
    stopFeed();
    logger.info('Social feed finished: all posts replayed.');
    return;
  }

  const post = SOCIAL_POSTS[nextIndex];
  nextIndex += 1;
  publishStatus();

  const place = PLACES[post.place];
  try {
    await ingestReport({
      source: 'social_media',
      text: post.text,
      lat: place.lat + (post.dLat ?? 0),
      lng: place.lng + (post.dLng ?? 0),
      address: `${place.name}, Chennai`,
      reporter: post.handle,
    });
  } catch (error) {
    logger.error(`Social feed could not process a post from ${post.handle}`, error);
  }
}

export function startFeed(): FeedStatus {
  if (timer) return getFeedStatus();
  if (nextIndex >= SOCIAL_POSTS.length) nextIndex = 0; // start over after a full run
  void postNext();
  timer = setInterval(() => void postNext(), env.SOCIAL_FEED_INTERVAL_SECONDS * 1000);
  publishStatus();
  return getFeedStatus();
}

export function stopFeed(): FeedStatus {
  if (timer) clearInterval(timer);
  timer = null;
  publishStatus();
  return getFeedStatus();
}

/** Back to the first post (does not delete reports already created). */
export function rewindFeed(): FeedStatus {
  stopFeed();
  nextIndex = 0;
  publishStatus();
  return getFeedStatus();
}
