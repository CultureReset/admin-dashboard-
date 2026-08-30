/**
 * The device protocol server. One WebSocket per device; the device dials out,
 * the node never dials in — so there are no inbound firewall rules and the same
 * code path serves home Wi-Fi and a phone hotspot over WireGuard.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { Db } from '../store/db.js';
import { CapabilityHost } from '../capabilities/host.js';
import { defaultBundle } from '../capabilities/policy.js';
import { Pipeline } from '../pipeline/index.js';
import { Session } from '../session.js';
import { ClientMessage, ServerMessage, Capabilities, PROTO_VERSION } from '../proto.js';

interface Bound { session: Session; deviceId: string }

export interface GatewayOptions { port: number; db: Db; host: CapabilityHost; pipeline: Pipeline }

export function startGateway(opts: GatewayOptions): { wss: WebSocketServer; close: () => Promise<void> } {
  const wss = new WebSocketServer({ port: opts.port });

  wss.on('connection', (ws: WebSocket) => {
    let announced: { deviceId: string; caps: Capabilities } | null = null;
    let bound: Bound | null = null;

    const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
    const fail = (code: string, message: string, id?: string) =>
      send({ type: 'error', ...(id ? { id } : {}), code, message });

    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = ClientMessage.parse(JSON.parse(String(raw)));
      } catch (e) {
        return fail('bad_message', e instanceof Error ? e.message : 'unparseable');
      }

      try {
        switch (msg.type) {
          case 'announce': {
            if (msg.proto !== PROTO_VERSION) {
              return fail('unsupported_proto', `this node speaks ${PROTO_VERSION}`);
            }
            announced = { deviceId: msg.device.id, caps: msg.capabilities };
            return;
          }

          case 'authenticate': {
            if (!announced) return fail('out_of_order', 'announce before authenticate');

            // Pairing decides the person. This is the only place it is decided;
            // every gate below reads it rather than receiving it.
            const rows = await opts.db.privileged<{
              person_id: string | null; household_id: string; capabilities: Capabilities;
            }>(`select person_id, household_id, capabilities from device
                 where id = $1 and device_key = $2`,
               [announced.deviceId, msg.device_key]);

            const dev = rows[0];
            if (!dev) return fail('unknown_device', 'device is not paired to this node');
            if (!dev.person_id) {
              // Shared device: household scope only until someone claims it.
              return fail('unbound_device',
                'this device is not bound to a person; claim it before making requests');
            }

            await opts.db.privileged(`update device set last_seen_at = now() where id = $1`,
              [announced.deviceId]);

            const person = { personId: dev.person_id, householdId: dev.household_id };
            bound = {
              deviceId: announced.deviceId,
              session: new Session(person, announced.caps, opts.host, opts.pipeline,
                                   defaultBundle(dev.person_id), announced.deviceId),
            };
            return send({
              type: 'ready', proto: PROTO_VERSION, person: dev.person_id,
              display: announced.caps.display?.class ?? 'none',
            });
          }

          case 'state': {
            if (!bound) return fail('not_ready', 'authenticate first');
            bound.session.state = {
              id: bound.deviceId,
              ...(msg.battery_pct !== undefined ? { batteryPct: msg.battery_pct } : {}),
              ...(msg.worn !== undefined ? { worn: msg.worn } : {}),
            };
            return;
          }

          case 'capture': {
            if (!bound) return fail('not_ready', 'authenticate first');
            bound.session.onCapture(msg.id, msg.image_ref);
            return;
          }

          case 'cancel': {
            bound?.session.cancel(msg.id);
            return;
          }

          case 'request': {
            if (!bound) return fail('not_ready', 'authenticate first', msg.id);
            // Presence is a security control, not just a battery saver: glasses
            // on a table are otherwise a permanent unattended identity.
            if (bound.session.state.worn === false) {
              return fail('not_worn', 'device reports it is not being worn; re-auth required', msg.id);
            }
            const answer = await bound.session.onRequest(msg.id, msg.audio_ref, msg.transcript_hint);
            send({ type: 'speak', id: msg.id, text: answer.speak, ms: answer.totalMs });
            send({ type: 'display', id: msg.id, card: answer.card });
            send({ type: 'timing', id: msg.id, ms: answer.timing, total_ms: answer.totalMs });
            return;
          }
        }
      } catch (err) {
        fail('internal', err instanceof Error ? err.message : String(err),
             'id' in msg ? (msg as { id: string }).id : undefined);
      }
    });
  });

  return {
    wss,
    close: () => new Promise<void>((res) => wss.close(() => res())),
  };
}
