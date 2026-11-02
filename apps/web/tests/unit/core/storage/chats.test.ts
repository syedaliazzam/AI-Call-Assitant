/**
 * Tests apps/web/src/core/storage/chats.ts: saving, listing (latest change first) and deleting the
 * Ask Kite chats on this device, and that "Delete all local data" removes them.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteChat, listChats, newChat, saveChat } from '@/core/storage/chats';
import { forgetDb, getDb } from '@/core/storage/db';
import { deleteAllLocalData } from '@/core/storage/wipe';

afterEach(async () => {
  await getDb().delete();
  forgetDb();
});

describe('chats', () => {
  it('saves and lists the latest change first', async () => {
    const older = { ...newChat(1), title: 'older' };
    const later = { ...newChat(2), title: 'later' };
    await saveChat(older);
    await saveChat(later);
    expect((await listChats()).map((chat) => chat.title)).toEqual(['later', 'older']);
    await saveChat({ ...older, updatedAt: 3 });
    expect((await listChats()).map((chat) => chat.title)).toEqual(['older', 'later']);
  });

  it('deletes a chat', async () => {
    const chat = newChat();
    await saveChat(chat);
    await deleteChat(chat.id);
    expect(await listChats()).toEqual([]);
  });

  it('is removed by "Delete all local data", and counted', async () => {
    await saveChat(newChat());
    const counts = await deleteAllLocalData();
    expect(counts.chats).toBe(1);
    expect(await listChats()).toEqual([]);
  });
});
