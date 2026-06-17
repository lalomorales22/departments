import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import {
  createEventStream,
  topicsFor,
  type EventStream,
  type Unsubscribe,
} from '@departments/realtime';
import type { DeptEvent } from '@departments/events';

/**
 * RealtimeGateway — the PRODUCTION realtime transport (WebSocket) over the same
 * {@link EventStream} spine the local SSE route uses. A client sends
 * `{ event: 'subscribe', data: { loopId, lastSeq } }`; the gateway REPLAYS every event
 * after the cursor then tails the live stream, multiplexing each `DeptEvent` onto its
 * frozen topics (`loopTopic/agentTopic/tasksTopic/SYSTEM_TOPIC`) so the cockpit can
 * demux per channel. Resume-by-seq, dedupe (the subscription's seq high-water mark),
 * always-settle, and heartbeats all come from the shared spine — this class is just the
 * WS adapter around it.
 *
 * Gated: with `REDIS_URL` it binds the Redis-backed stream (a tree of gateway replicas
 * share one Redis); without it, the in-memory stream (single process). It is authored +
 * typechecked here and exercised under `docker compose up -d` (Redis), not on this box.
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly stream: EventStream = createEventStream({ redisUrl: process.env.REDIS_URL });
  /** client → (loopId → unsubscribe). */
  private readonly subs = new Map<WebSocket, Map<string, Unsubscribe>>();
  private readonly heartbeats = new Map<WebSocket, ReturnType<typeof setInterval>>();

  handleConnection(client: WebSocket): void {
    this.subs.set(client, new Map());
    const hb = setInterval(() => {
      try {
        if (client.readyState === WebSocket.OPEN) client.ping();
      } catch {
        /* client gone — handleDisconnect will clean up */
      }
    }, 15_000);
    this.heartbeats.set(client, hb);
  }

  handleDisconnect(client: WebSocket): void {
    for (const unsub of this.subs.get(client)?.values() ?? []) unsub();
    this.subs.delete(client);
    const hb = this.heartbeats.get(client);
    if (hb) clearInterval(hb);
    this.heartbeats.delete(client);
  }

  /** `{ event:'subscribe', data:{ loopId, lastSeq } }` → replay-after-cursor + tail. */
  @SubscribeMessage('subscribe')
  onSubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: { loopId?: string; lastSeq?: number },
  ): void {
    const loopId = typeof body?.loopId === 'string' ? body.loopId : '';
    if (!loopId) return;
    const cursor = typeof body.lastSeq === 'number' && Number.isFinite(body.lastSeq) ? body.lastSeq : -1;

    const clientSubs = this.subs.get(client);
    if (!clientSubs) return;
    clientSubs.get(loopId)?.(); // replace an existing subscription for the same loop

    const unsub = this.stream.subscribe(loopId, cursor, (e: DeptEvent) => {
      this.send(client, { event: 'event', data: { topics: topicsFor(e), event: e } });
    });
    clientSubs.set(loopId, unsub);
    this.send(client, { event: 'subscribed', data: { loopId, cursor } });
  }

  /** `{ event:'unsubscribe', data:{ loopId } }` → drop that loop's subscription. */
  @SubscribeMessage('unsubscribe')
  onUnsubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() body: { loopId?: string },
  ): void {
    const loopId = typeof body?.loopId === 'string' ? body.loopId : '';
    if (!loopId) return;
    const clientSubs = this.subs.get(client);
    clientSubs?.get(loopId)?.();
    clientSubs?.delete(loopId);
  }

  private send(client: WebSocket, msg: unknown): void {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
    } catch {
      /* a dropped client is reaped by handleDisconnect */
    }
  }
}
