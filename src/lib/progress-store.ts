import "server-only";

import { CONTENT_BY_ID, MCU_CONTENT, UNIVERSE_CONTENT, itemComplete, missingPrerequisite, type ContentItem } from "@/lib/content";
import { db, ensureDatabase } from "@/lib/db";

export type ProgressRecord = { contentId: string; episode: number };

export async function getProgress(userId: string): Promise<ProgressRecord[]> {
  await ensureDatabase();
  const result = await db.execute({
    sql: "SELECT content_id, episode FROM progress WHERE user_id = ? ORDER BY watched_at ASC",
    args: [userId],
  });
  return result.rows.map((row) => ({
    contentId: String(row.content_id),
    episode: Number(row.episode),
  }));
}

export function recordsToSet(records: ProgressRecord[]) {
  return new Set(records.map((record) => `${record.contentId}:${record.episode}`));
}

export function serverUnlockReason(item: ContentItem, watched: Set<string>) {
  const missing = missingPrerequisite(item, watched);
  if (missing) return `Complete ${missing.title} first.`;
  if (new Date(`${item.releaseDate}T00:00:00`).getTime() > Date.now()) {
    return `${item.title} has not been released yet.`;
  }
  return null;
}

async function clearInvalidCompletedItems(userId: string, universe: ContentItem["universe"]) {
  const current = recordsToSet(await getProgress(userId));
  let clearedDependent = true;

  while (clearedDependent) {
    clearedDependent = false;
    for (const candidate of UNIVERSE_CONTENT[universe]) {
      if (!itemComplete(candidate, current) || !serverUnlockReason(candidate, current)) continue;
      await db.execute({
        sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ?",
        args: [userId, candidate.id],
      });
      for (const key of [...current]) {
        if (key.startsWith(`${candidate.id}:`)) current.delete(key);
      }
      clearedDependent = true;
    }
  }
}

async function clearDependents(userId: string, item: ContentItem, episode: number) {
  if (item.kind === "series" && episode > 0) {
    await db.execute({
      sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ? AND episode > ?",
      args: [userId, item.id, episode],
    });
  }

  if (!item.required && item.id !== "deadpool-2") return;
  if (item.universe === "xmen" || item.universe === "street") {
    await clearInvalidCompletedItems(userId, item.universe);
  } else {
    const list = UNIVERSE_CONTENT[item.universe];
    const index = list.findIndex((candidate) => candidate.id === item.id);
    for (const candidate of list.slice(index + 1)) {
      await db.execute({
        sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ?",
        args: [userId, candidate.id],
      });
    }
  }

  if (item.id === "xmen-2000") {
    const madnessIndex = MCU_CONTENT.findIndex((candidate) => candidate.id === "multiverse-of-madness");
    for (const candidate of MCU_CONTENT.slice(madnessIndex)) {
      await db.execute({
        sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ?",
        args: [userId, candidate.id],
      });
    }
  }

  if (item.id === "endgame") {
    await clearInvalidCompletedItems(userId, "street");
  }
}

export async function updateProgress(
  userId: string,
  contentId: string,
  episode: number,
  watchedValue: boolean,
) {
  await ensureDatabase();
  const item = CONTENT_BY_ID.get(contentId);
  if (!item) throw new Error("Unknown timeline entry.");

  const records = await getProgress(userId);
  const watched = recordsToSet(records);

  if (watchedValue) {
    const lockReason = serverUnlockReason(item, watched);
    if (lockReason) throw new Error(lockReason);

    if (item.kind === "series") {
      const validEpisode = item.episodes?.some((candidate) => candidate.id === episode);
      if (!validEpisode) throw new Error("Unknown episode.");
      if (episode > 1 && !watched.has(`${item.id}:${episode - 1}`)) {
        throw new Error(`Complete episode ${episode - 1} first.`);
      }
    } else if (episode !== -1) {
      throw new Error("Movies and specials do not use episode progress.");
    }

    await db.execute({
      sql: `INSERT INTO progress (user_id, content_id, episode, watched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, content_id, episode)
            DO UPDATE SET watched_at = excluded.watched_at`,
      args: [userId, contentId, episode, new Date().toISOString()],
    });
  } else {
    await db.execute({
      sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ? AND episode = ?",
      args: [userId, contentId, episode],
    });
    await clearDependents(userId, item, episode);
  }

  return getProgress(userId);
}
