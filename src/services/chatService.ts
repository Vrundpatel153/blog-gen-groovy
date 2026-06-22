// ============================================================================
// Chat Service — Frontend API client (talks to Express backend)
// ============================================================================

const API_BASE = '/api';

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.error || `API error: ${res.status}`);
  }

  return json.data as T;
}

export interface ChatThread {
  id: string;
  blogId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  sender: 'user' | 'assistant';
  text: string;
  showDiffCard: boolean;
  time: string;
  createdAt?: string;
  actionType?: string;
  actionData?: Record<string, unknown>;
}

export const chatService = {
  async createThread(blogId: string, title: string = 'New Conversation'): Promise<ChatThread> {
    return apiFetch('/chat/threads', {
      method: 'POST',
      body: JSON.stringify({ blogId, title }),
    });
  },

  async getThreads(blogId: string): Promise<ChatThread[]> {
    return apiFetch(`/chat/threads/${blogId}`);
  },

  async sendMessage(
    threadId: string,
    message: string,
    blogContext?: {
      title: string;
      subtitle?: string;
      tone: string;
      audience: string;
      sections: any[];
      activeSectionId?: string;
      selectedText?: string;
      selectedField?: 'title' | 'section';
    }
  ): Promise<{
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    actionType?: string;
    actionData?: Record<string, unknown>;
  }> {
    return apiFetch(`/chat/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, blogContext }),
    });
  },

  async getMessages(threadId: string): Promise<ChatMessage[]> {
    return apiFetch(`/chat/threads/${threadId}/messages`);
  },

  async updateMessageActionData(
    messageId: string,
    payload: { actionData?: Record<string, unknown>; showDiffCard?: boolean }
  ): Promise<ChatMessage> {
    return apiFetch(`/chat/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
