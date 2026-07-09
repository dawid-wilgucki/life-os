import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  afterNextRender,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatMessage } from '@life-os/shared-types';
import { ChatService } from './chat.service';
import { PageBackgroundComponent } from '../../shared/page-background.component';

interface DisplayMessage {
  role: 'user' | 'model';
  text: string;
  actions?: string[];
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, PageBackgroundComponent],
  template: `
    <app-page-background theme="chat" />
    <!-- Fill exactly the space between the top bar and bottom nav (dvh tracks the
         mobile browser chrome; the vars are 0 on desktop). -->
    <div class="relative flex flex-col" style="height: calc(100dvh - var(--top-bar-h) - var(--bottom-nav-h))">

      <!-- Header -->
      <div class="border-b border-surface-800 px-4 py-3">
        <h1 class="flex items-center gap-2 text-base font-semibold">
          <span>✨</span> Asystent Life.OS
        </h1>
        <p class="text-xs text-slate-500">Gemini 3.5 Flash · kontekst na żywo</p>
      </div>

      <!-- Messages -->
      <div #scrollContainer class="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        @if (messages().length === 0) {
          <div class="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div class="text-4xl">🤖</div>
            <p class="text-slate-400 text-sm max-w-xs">
              Cześć! Mam dostęp do Twoich zadań, kalendarza, nawyków i inboxa.<br>
              Możesz mi też zlecić dodanie czegoś.
            </p>
            <div class="flex flex-wrap justify-center gap-2 mt-2">
              @for (hint of hints; track hint) {
                <button
                  class="lo-btn-ghost border border-surface-700 text-xs px-3 py-1.5"
                  (click)="useHint(hint)"
                >{{ hint }}</button>
              }
            </div>
          </div>
        }

        @for (msg of messages(); track $index) {
          <div [class]="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
            <div
              [class]="msg.role === 'user'
                ? 'max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm text-white'
                : 'max-w-[80%] lo-card px-4 py-2.5 text-sm text-slate-100'"
            >
              <p class="whitespace-pre-wrap leading-relaxed">{{ msg.text }}</p>

              @if (msg.actions && msg.actions.length) {
                <div class="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
                  @for (action of msg.actions; track action) {
                    <span class="text-[11px] text-emerald-400">✓ {{ action }}</span>
                  }
                </div>
              }
            </div>
          </div>
        }

        @if (loading()) {
          <div class="flex justify-start">
            <div class="lo-card px-4 py-3">
              <div class="flex gap-1 items-center">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]"></span>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Input -->
      <div class="border-t border-surface-800 px-4 py-3">
        <form class="flex gap-2" (ngSubmit)="send()">
          <input
            #inputField
            class="lo-input flex-1"
            placeholder="Napisz wiadomość…"
            [(ngModel)]="draft"
            name="draft"
            autocomplete="off"
            [disabled]="loading()"
          />
          <button
            type="submit"
            class="lo-btn px-4 shrink-0"
            [disabled]="loading() || !draft.trim()"
          >
            Wyślij
          </button>
        </form>
      </div>
    </div>
  `,
})
export class ChatComponent {
  private chatService = inject(ChatService);

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('inputField') private inputField!: ElementRef<HTMLInputElement>;

  messages = signal<DisplayMessage[]>([]);
  loading = signal(false);
  draft = '';

  hints = [
    'Co mam dziś do zrobienia?',
    'Jakie mam nawyki na dziś?',
    'Dodaj do inboxa: kupić kwiaty',
    'Jakie mam nadchodzące wydarzenia?',
  ];

  constructor() {
    afterNextRender(() => {
      this.inputField?.nativeElement.focus();
    });
  }

  useHint(hint: string): void {
    this.draft = hint;
    this.send();
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || this.loading()) return;
    this.draft = '';

    this.messages.update((prev) => [...prev, { role: 'user', text }]);
    this.scrollToBottom();
    this.loading.set(true);

    const history: ChatMessage[] = this.messages().map((m) => ({
      role: m.role,
      text: m.text,
    }));

    this.chatService.send(history).subscribe({
      next: (res) => {
        this.messages.update((prev) => [
          ...prev,
          { role: 'model', text: res.reply, actions: res.actions_taken },
        ]);
        this.loading.set(false);
        this.scrollToBottom();
        setTimeout(() => this.inputField?.nativeElement.focus(), 50);
      },
      error: () => {
        this.messages.update((prev) => [
          ...prev,
          { role: 'model', text: 'Ups, coś poszło nie tak. Spróbuj ponownie.' },
        ]);
        this.loading.set(false);
        this.scrollToBottom();
      },
    });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scrollContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }
}
