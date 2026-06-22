import { Injectable, inject } from '@angular/core';
import type { ChatMessage, ChatResponse } from '@life-os/shared-types';
import { ApiService } from '../../core/api.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private api = inject(ApiService);

  send(messages: ChatMessage[]) {
    return this.api.post<ChatResponse>('/api/chat', { messages });
  }
}
