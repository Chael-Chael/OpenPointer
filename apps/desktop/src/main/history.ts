import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Conversation, ChatTurn } from '@openpointer/core';

export class ChatHistoryManager {
  private filePath: string;
  private conversations: Map<string, Conversation> = new Map();
  private loaded = false;

  constructor() {
    const userData = app.getPath('userData');
    this.filePath = path.join(userData, 'chat_history.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed: Conversation[] = JSON.parse(data);
      for (const conv of parsed) {
        this.conversations.set(conv.id, conv);
      }
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[omp] Failed to load chat history:', e);
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const data = Array.from(this.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    try {
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[omp] Failed to save chat history:', e);
    }
  }

  async getConversations(): Promise<Conversation[]> {
    await this.load();
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        ...c,
        turns: [] // Don't return full turns for the list view to save memory/bandwidth
      }));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.load();
    return this.conversations.get(id) || null;
  }

  async deleteConversation(id: string): Promise<void> {
    await this.load();
    if (this.conversations.has(id)) {
      this.conversations.delete(id);
      await this.save();
    }
  }

  async appendTurn(conversationId: string, turn: ChatTurn): Promise<Conversation> {
    await this.load();
    let conv = this.conversations.get(conversationId);
    const now = Date.now();
    if (!conv) {
      conv = {
        id: conversationId,
        turns: [],
        createdAt: now,
        updatedAt: now,
        title: turn.text.slice(0, 50) + (turn.text.length > 50 ? '...' : '')
      };
      this.conversations.set(conversationId, conv);
    }
    conv.turns.push(turn);
    conv.updatedAt = now;
    await this.save();
    return conv;
  }

  async setClaudeAgentSession(conversationId: string, sessionId: string): Promise<Conversation | null> {
    await this.load();
    const conv = this.conversations.get(conversationId);
    if (!conv) return null;
    conv.backendSessions = {
      ...conv.backendSessions,
      claudeAgent: { sessionId }
    };
    conv.updatedAt = Date.now();
    await this.save();
    return conv;
  }
}
