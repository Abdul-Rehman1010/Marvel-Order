import "server-only";

import { CONTENT_BY_ID, MCU_CONTENT, STREET_CONTENT, UNIVERSE_CONTENT, type ContentItem } from "@/lib/content";
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

function entryComplete(item: ContentItem, watched: Set<string>) {
  if (item.kind !== "series") return watched.has(`${item.id}:-1`);
  return (item.episodes ?? []).every((episode) => watched.has(`${item.id}:${episode.id}`));
}

export function serverUnlockReason(item: ContentItem, watched: Set<string>) {
  if (item.id === "hawkeye") {
    const endgame = CONTENT_BY_ID.get("endgame");
    if (endgame && !entryComplete(endgame, watched)) {
      return "Complete Avengers: Endgame first to establish Clint Barton's post-Blip story.";
    }
  }
  if (item.id === "deadpool") {
    const xmen = CONTENT_BY_ID.get("xmen-2000");
    if (xmen && !entryComplete(xmen, watched)) {
      return "Complete X-Men (2000) first to establish Deadpool's legacy mutant universe.";
    }
  }

  if (item.id === "deadpool-2") {
    const deadpool = CONTENT_BY_ID.get("deadpool");
    if (deadpool && !entryComplete(deadpool, watched)) {
      return "Complete Deadpool first.";
    }
  }

  if (!["deadpool", "deadpool-2"].includes(item.id)) {
    const list = UNIVERSE_CONTENT[item.universe];
    const index = list.findIndex((candidate) => candidate.id === item.id);
    const missing = list
      .slice(0, index)
      .filter((candidate) => candidate.required)
      .find((candidate) => !entryComplete(candidate, watched));

    if (missing) return `Complete ${missing.title} first.`;
  }
  if (item.id === "multiverse-of-madness") {
    const xmen = CONTENT_BY_ID.get("xmen-2000");
    if (xmen && !entryComplete(xmen, watched)) {
      return "Complete X-Men (2000) first to establish the legacy mutant continuity.";
    }
  }
  if (new Date(`${item.releaseDate}T00:00:00`).getTime() > Date.now()) {
    return `${item.title} has not been released yet.`;
  }
  return null;
}

async function clearDependents(userId: string, item: ContentItem, episode: number) {
  if (item.kind === "series" && episode > 0) {
    await db.execute({
      sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ? AND episode > ?",
      args: [userId, item.id, episode],
    });
  }

  if (!item.required) return;
  if (item.universe === "xmen") {
    const current = recordsToSet(await getProgress(userId));
    let clearedDependent = true;

    while (clearedDependent) {
      clearedDependent = false;
      for (const candidate of UNIVERSE_CONTENT.xmen) {
        if (!entryComplete(candidate, current) || !serverUnlockReason(candidate, current)) continue;
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
    const hawkeyeIndex = STREET_CONTENT.findIndex((candidate) => candidate.id === "hawkeye");
    for (const candidate of STREET_CONTENT.slice(hawkeyeIndex)) {
      await db.execute({
        sql: "DELETE FROM progress WHERE user_id = ? AND content_id = ?",
        args: [userId, candidate.id],
      });
    }
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
