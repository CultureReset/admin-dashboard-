/**
 * A third-party app, compiled to WebAssembly.
 *
 * It has no ambient authority whatsoever. Every effect it has on the world goes
 * through `invoke`, which the host gates on the app's capability token — so the
 * manifest and the sandbox cannot drift apart.
 */
import { invoke, packString, unpackString, alloc as _alloc, log } from './og';

export function alloc(size: i32): usize { return _alloc(size); }

/**
 * input : {"description": "...", "confidence": 0.92, "transcript": "..."}
 * output: {"speak": "...", "card": {...}}
 */
export function run(inPtr: usize, _inLen: i32): usize {
  const input = unpackString(inPtr);

  const description = field(input, 'description');
  const confidence = parseFloat(field(input, 'confidence'));

  if (description.length == 0) {
    return packString('{"speak":"I could not see a plant just then."}');
  }

  // Remember what we identified, so "what was that plant?" works later.
  invoke('entity.create', '{"kind":"plant","name":' + quote(description) + '}');

  // Per-(app, person) storage. Two people running this app get two namespaces;
  // another app under the same person cannot read this key at all.
  const seenRaw = invoke('kv.get', '{"key":"seen_count"}');
  const seen = seenRaw == 'null' || seenRaw.length == 0 ? 0 : <i32>parseFloat(seenRaw);
  invoke('kv.set', '{"key":"seen_count","value":' + (seen + 1).toString() + '}');

  log('plant-id identified: ' + description);

  const care = confidence > 0.8
    ? 'Bright indirect light, water when the top inch is dry.'
    : 'I am not certain enough to give care advice.';

  return packString(
    '{"speak":' + quote("That's " + description + '. ' + care) + ',' +
    '"card":{"title":' + quote(description) + ',"body":' + quote(care) +
    ',"meta":' + quote((seen + 1).toString() + ' plants identified') + ',"ttl_ms":5000}}',
  );
}

/** Deliberately minimal JSON reading — apps get values, not a parser to exploit. */
function field(json: string, key: string): string {
  const needle = '"' + key + '":';
  const at = json.indexOf(needle);
  if (at < 0) return '';
  let i = at + needle.length;
  while (i < json.length && json.charCodeAt(i) == 32) i++;
  if (i < json.length && json.charCodeAt(i) == 34) {
    i++;
    let out = '';
    while (i < json.length && json.charCodeAt(i) != 34) {
      if (json.charCodeAt(i) == 92) i++;
      out += json.charAt(i);
      i++;
    }
    return out;
  }
  let end = i;
  while (end < json.length) {
    const c = json.charCodeAt(end);
    if (c == 44 || c == 125) break;
    end++;
  }
  return json.slice(i, end).trim();
}

function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c == 34) out += '\\"';
    else if (c == 92) out += '\\\\';
    else if (c == 10) out += '\\n';
    else out += s.charAt(i);
  }
  return out + '"';
}

/** Present only so the runaway-app test has something to run away with. */
export function spin(): void { while (true) {} }
